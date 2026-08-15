import { Router } from 'express';
import { downloaders, runDownloadJob } from '../downloaders/index.js';
import { YTDLP_HOST_RE } from '../downloaders/ytdlp.js';
import { isSafeName, validateKind } from '../validate.js';
import { createJob } from '../jobs.js';

const router = Router();

// Every route here fire-and-forgets so a slow size probe doesn't delay the HTTP response.
// The job entry is created synchronously, before that probe, so the returned jobId is
// already pollable on /jobs the instant the caller holds it.

/**
 * Start one background download and return its job id (docs/JOBS.md). Shared with
 * `/download-item`, which starts a job per resolved target.
 * @param {object} downloader  a `downloaders` entry
 * @param {object} input  `{url, headers?}` — what the downloader builds its command from
 * @param {{ course: string, lecture: string, kind: string, ref?: string|null,
 *           fromCache?: boolean, reresolve?: (() => Promise<object>)|null }} meta
 *   reresolve refreshes a stale cached cap so the SAME job re-runs; null when there is no ref.
 */
export function startJob(
  downloader,
  input,
  { course, lecture, kind, ref = null, fromCache = false, reresolve = null },
) {
  const jobId = createJob({ course, lecture, kind, tool: downloader.tool, ref, fromCache });
  runDownloadJob(downloader, input, { course, lecture, kind, jobId, fromCache, reresolve });
  return jobId;
}

// The extension reads `status`/`target` verbatim, so the three public routes keep answering
// with them alongside the job id.
function startAndAnswer(res, downloader, input, { course, lecture, kind }) {
  const jobId = startJob(downloader, input, { course, lecture, kind });
  res.json({ status: 'Downloading in background...', target: `${course}/${lecture}`, jobId });
}

router.post('/download', (req, res) => {
  const { url, headers, course, lecture, kind = 'lecture' } = req.body ?? {};
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'valid url required' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return res.status(400).json({ error: 'course and lecture are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  startAndAnswer(res, downloaders.curl, { url, headers }, { course, lecture, kind });
});

// Plain URL (no header replay) added to the lecture's materials.
router.post('/download-file', (req, res) => {
  const { url, course, lecture, kind = 'lecture' } = req.body ?? {};
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'valid url required' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return res.status(400).json({ error: 'course and lecture are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  startAndAnswer(res, downloaders.fetch, { url }, { course, lecture, kind });
});

router.post('/download-youtube', (req, res) => {
  const { url, course, lecture, kind = 'lecture' } = req.body ?? {};
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  if (!host || !YTDLP_HOST_RE.test(host)) {
    return res.status(400).json({ error: 'valid youtube or google drive url required' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return res.status(400).json({ error: 'course and lecture are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  startAndAnswer(res, downloaders.ytdlp, { url }, { course, lecture, kind });
});

export default router;
