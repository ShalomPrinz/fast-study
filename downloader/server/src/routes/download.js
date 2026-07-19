import { Router } from 'express';
import { downloaders, runDownloadJob } from '../downloaders/index.js';
import { YTDLP_HOST_RE } from '../downloaders/ytdlp.js';
import { isSafeName, validateKind } from '../validate.js';

const router = Router();

// Both routes fire-and-forget so a slow size probe doesn't delay the HTTP response.

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

  runDownloadJob(downloaders.curl, { url, headers }, { course, lecture, kind });
  res.json({ status: 'Downloading in background...', target: `${course}/${lecture}` });
});

router.post('/download-youtube', (req, res) => {
  const { url, course, lecture, kind = 'lecture' } = req.body ?? {};
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

  runDownloadJob(downloaders.ytdlp, { url }, { course, lecture, kind });
  res.json({ status: 'Downloading in background...', target: `${course}/${lecture}` });
});

export default router;
