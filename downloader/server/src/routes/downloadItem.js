import { Router } from 'express';
import { downloaders } from '../downloaders/index.js';
import { isSafeName, validateKind } from '../validate.js';
import { resolve } from '../services/autodl.js';
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

// Re-resolve ONE target fresh after its cached cap auth-failed mid-download, so the runner can
// re-run the same job. `only`+`forceCapture` is what makes the answer a fresh (non-cached) cap,
// which is what stops a second retry — see docs/JOBS.md.
function makeReresolve({ ref, course, name, kind }) {
  return async () => {
    const { ok, status, body } = await resolve({
      ref,
      course,
      name,
      kind,
      only: true,
      forceCapture: true,
    });
    if (!ok) return { ok: false, status, body };
    const fresh = body?.targets?.find((t) => t.name === name) ?? body?.targets?.[0];
    const run = fresh && toRun(fresh);
    if (!run) return { ok: false, status, body: { error: 'auto returned no usable target' } };
    return { ok: true, ...run };
  };
}

// Download one discovery row: auto/ resolves the ref into targets, this server runs each as a
// job. auto's 401/409/422 bodies are forwarded verbatim — they are the frontend's contract.
// `only`/`forceCapture` are auto's, passed through untouched: a per-clip retry sends
// `only:true` with a zoom split name, which only auto's `only` branch resolves correctly.
router.post('/download-item', async (req, res) => {
  const { ref, course, name, kind = 'lecture', only, forceCapture } = req.body ?? {};
  if (typeof ref !== 'string' || !ref) return res.status(400).json({ error: 'valid ref required' });
  if (!isSafeName(course) || !isSafeName(name)) {
    return res.status(400).json({ error: 'course and name are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  const { ok, status, body } = await resolve({
    ref,
    course,
    name,
    kind,
    only: only === true,
    forceCapture: forceCapture === true,
  });
  if (!ok) {
    return res.status(status || 502).json(body ?? { error: 'auto-downloader unreachable' });
  }

  const targets = body?.targets ?? [];
  const runs = targets.map(toRun);
  if (!targets.length || runs.some((r) => !r)) {
    return res.status(502).json({ error: 'auto returned no usable target' });
  }

  const jobIds = runs.map(({ downloader, input }, i) =>
    startJob(downloader, input, {
      course,
      lecture: targets[i].name,
      kind,
      ref,
      fromCache: targets[i].fromCache === true,
      reresolve: makeReresolve({ ref, course, name: targets[i].name, kind }),
    }),
  );
  res.json({ media: body.media, jobIds });
});

export default router;
