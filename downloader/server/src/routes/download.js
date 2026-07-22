import { Router } from 'express';
import { downloaders, runDownloadJob } from '../downloaders/index.js';
import { YTDLP_HOST_RE } from '../downloaders/ytdlp.js';
import { isSafeName, validateKind } from '../validate.js';
import { createJob } from '../jobs.js';

const router = Router();

// Both routes fire-and-forget so a slow size probe doesn't delay the HTTP response.
// The job entry is created HERE, before that probe, so the returned jobId is already
// pollable on /jobs the instant the caller holds it.

// Start a background download and answer with its job id (docs/JOBS.md). The legacy
// status/target fields stay for the extension popup, which shows them verbatim.
function startJob(res, downloader, input, { course, lecture, kind, ref }) {
  const jobId = createJob({ course, lecture, kind, tool: downloader.tool, ref });
  runDownloadJob(downloader, input, { course, lecture, kind, jobId });
  res.json({ status: 'Downloading in background...', target: `${course}/${lecture}`, jobId });
}

router.post('/download', (req, res) => {
  const { url, headers, course, lecture, kind = 'lecture', ref } = req.body ?? {};
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'valid url required' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return res.status(400).json({ error: 'course and lecture are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  startJob(res, downloaders.curl, { url, headers }, { course, lecture, kind, ref: typeof ref === 'string' ? ref : null });
});

router.post('/download-youtube', (req, res) => {
  const { url, course, lecture, kind = 'lecture', ref } = req.body ?? {};
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  if (!host || !YTDLP_HOST_RE.test(host)) {
    return res.status(400).json({ error: 'valid youtube or google drive url required' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return res.status(400).json({ error: 'course and lecture are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  startJob(res, downloaders.ytdlp, { url }, { course, lecture, kind, ref: typeof ref === 'string' ? ref : null });
});

export default router;
