import { Router } from 'express';
import { downloaders } from '../downloaders/index.js';
import { storedName, validateKind } from '../validate.js';
import { resolve, resolved } from '../services/autodl.js';
import { startJob } from './download.js';

const router = Router();

// A resolved target → the downloader + input pair a job runs it with. Only curl replays
// captured headers; the other two take a bare url.
function toRun(target) {
  const downloader = downloaders[target?.tool];
  if (!downloader) return null;
  return {
    downloader,
    input:
      target.tool === 'curl' ? { url: target.url, headers: target.headers } : { url: target.url },
  };
}

// Map a failed re-resolve to the job's terminal message: recovery couldn't proceed, so the
// reason has to be user-actionable rather than the raw stderr of the stale attempt. Lives here
// because what auto's statuses MEAN is the resolver edge's knowledge, not the runner's.
function reresolveMessage(status, body) {
  if (status === 401) return 'reconnect Moodle';
  if (status === 409) return 'passcode needed';
  if (status === 422) return `source unsupported${body?.message ? `: ${body.message}` : ''}`;
  return `re-capture failed: ${body?.error ?? `HTTP ${status || 'network'}`}`;
}

// Re-resolve ONE target fresh after its cached cap auth-failed mid-download, so the runner can
// re-run the same job: `{downloader, input}` to re-run, or `{error}` with the terminal message.
// `only`+`forceCapture` is what makes the answer a fresh (non-cached) cap, which is what stops a
// second retry — see docs/JOBS.md.
function makeReresolve({ ref, course, name, kind }) {
  return async () => {
    const { status, body } = await resolve({
      ref,
      course,
      name,
      kind,
      only: true,
      forceCapture: true,
    });
    if (!resolved(status)) return { error: reresolveMessage(status, body) };
    const fresh = body?.targets?.find((t) => t.name === name) ?? body?.targets?.[0];
    const run = fresh && toRun(fresh);
    // A 2xx we can't run is still a failed re-resolve; it reads as the generic failure because
    // no status describes it — auto's own was a 200.
    if (!run) return { error: 're-capture failed: auto returned no usable target' };
    return run;
  };
}

/**
 * Download one discovery row: auto/ resolves the ref into targets, this server runs each as a
 * job. The answer is `{status, body}` rather than a thrown error because auto's 401/409/422
 * bodies are forwarded verbatim — they are the caller's contract, and both callers (the route
 * below and the section-run driver in `runs.js`) branch on that status.
 * `only`/`forceCapture` are auto's, passed through untouched: a per-clip retry sends
 * `only:true` with a zoom split name, which only auto's `only` branch resolves correctly.
 * Names are canonicalized here, so `renames` reports the row whose spelling the server rewrote
 * (empty for the section-run driver, whose targets are already canonical).
 * @returns {Promise<{status: number, body: object}>} 200 → `{media, jobIds, renames}`
 */
export async function downloadItem({
  ref,
  course: rawCourse,
  name: rawName,
  kind,
  only = false,
  forceCapture = false,
}) {
  const course = storedName(rawCourse);
  const name = storedName(rawName);
  const renames = name === rawName ? [] : [{ ref, name }];
  const { status, body } = await resolve({ ref, course, name, kind, only, forceCapture });
  if (!resolved(status)) {
    return { status: status || 502, body: body ?? { error: 'auto-downloader unreachable' } };
  }

  const targets = body?.targets ?? [];
  const runs = targets.map(toRun);
  if (!targets.length || runs.some((r) => !r)) {
    return { status: 502, body: { error: 'auto returned no usable target' } };
  }

  // The job's lecture is the stored spelling; a zoom split's `.1`/`.2` can push a long base past
  // the length budget. `reresolve` keeps auto's own name, which is the key into its replay cache.
  const jobIds = runs.map(({ downloader, input }, i) =>
    startJob(downloader, input, {
      course,
      lecture: storedName(targets[i].name),
      kind,
      ref,
      fromCache: targets[i].fromCache === true,
      reresolve: makeReresolve({ ref, course, name: targets[i].name, kind }),
    }),
  );
  return { status: 200, body: { media: body.media, jobIds, renames } };
}

router.post('/download-item', async (req, res) => {
  const { ref, course, name, kind = 'lecture', only, forceCapture } = req.body ?? {};
  if (typeof ref !== 'string' || !ref) return res.status(400).json({ error: 'valid ref required' });
  if (!storedName(course) || !storedName(name)) {
    return res.status(400).json({ error: 'course and name with a legal character are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  const { status, body } = await downloadItem({
    ref,
    course,
    name,
    kind,
    only: only === true,
    forceCapture: forceCapture === true,
  });
  res.status(status).json(body);
});

export default router;
