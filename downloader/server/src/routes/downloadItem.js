import { Router } from 'express';
import { downloaders } from '../downloaders/index.js';
import { invalidRequest, storedName, validateKind } from '../validate.js';
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

// A failed re-resolve → the job's terminal failure. Here, not in the runner, because what auto's
// statuses MEAN is the resolver edge's knowledge.
export function reresolveFailure(status, body) {
  if (status === 401)
    return { error: 'reconnect Moodle', code: 'recapture_reconnect_required', params: {} };
  if (status === 409)
    return { error: 'passcode needed', code: 'recapture_passcode_required', params: {} };
  if (status === 422)
    return {
      error: `source unsupported${body?.message ? `: ${body.message}` : ''}`,
      code: 'recapture_unsupported',
      params: { detail: body?.message ?? null },
    };
  return recaptureFailed(body?.error ?? `HTTP ${status || 'network'}`);
}

function recaptureFailed(detail) {
  return { error: `re-capture failed: ${detail}`, code: 'recapture_failed', params: { detail } };
}

// Re-resolve ONE target fresh → `{downloader, input}` or `{error}`. `only`+`forceCapture` makes
// the cap fresh (non-cached), which is what stops a second retry — see docs/JOBS.md.
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
    if (!resolved(status)) return { failure: reresolveFailure(status, body) };
    const fresh = body?.targets?.find((t) => t.name === name) ?? body?.targets?.[0];
    const run = fresh && toRun(fresh);
    // A 2xx we can't run is still a failed re-resolve; it reads as the generic failure because
    // no status describes it — auto's own was a 200.
    if (!run) return { failure: recaptureFailed('auto returned no usable target') };
    return run;
  };
}

/**
 * Download one discovery row: auto/ resolves the ref, this server runs a job per target. Returns
 * `{status, body}`, never throws: auto's 401/409/422 bodies are both callers' contract, verbatim.
 * `only`/`forceCapture` pass through to auto untouched (a per-clip zoom retry needs `only`).
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
    // auto's own body — code included — is forwarded verbatim; the fallback is for a non-2xx it
    // answered with nothing parseable.
    return {
      status: status || 502,
      body: body ?? {
        error: 'auto-downloader unreachable',
        code: 'autodl_unreachable',
        params: { detail: `HTTP ${status}` },
      },
    };
  }

  const targets = body?.targets ?? [];
  const runs = targets.map(toRun);
  if (!targets.length || runs.some((r) => !r)) {
    return {
      status: 502,
      body: { error: 'auto returned no usable target', code: 'autodl_no_target', params: {} },
    };
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
  if (typeof ref !== 'string' || !ref)
    return res.status(400).json(invalidRequest('ref', 'valid ref required'));
  if (!storedName(course) || !storedName(name)) {
    return res
      .status(400)
      .json(
        invalidRequest(
          storedName(course) ? 'name' : 'course',
          'course and name with a legal character are required',
        ),
      );
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
