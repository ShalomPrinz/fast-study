import { Router } from 'express';
import { probeContentLength } from '../services/probe.js';
import { probeHlsBytes, classifyCaptures, MAX_CAPTURES } from '../services/hls.js';
import { invalidRequest } from '../validate.js';
import { isHlsUrl } from '../hlsPlaylist.js';

const router = Router();

// The popup calls this because fetch strips the captured Cookie header the probe needs.
// An .m3u8 url answers the master's estimated bytes (null for anything else).
router.post('/probe-size', async (req, res) => {
  const { url, headers } = req.body ?? {};
  const bytes = isHlsUrl(url)
    ? await probeHlsBytes(url, headers)
    : await probeContentLength(url, headers);
  res.json({ bytes });
});

// The popup's captured .m3u8 requests in, the streams worth offering out (docs/DOWNLOAD.md, "HLS").
router.post('/hls-streams', async (req, res) => {
  const { captures } = req.body ?? {};
  if (!Array.isArray(captures) || captures.length > MAX_CAPTURES) {
    return res
      .status(400)
      .json(invalidRequest('captures', `captures must be an array of at most ${MAX_CAPTURES}`));
  }
  const valid = captures.filter(
    (c) =>
      typeof c?.url === 'string' &&
      (c.headers === undefined || Array.isArray(c.headers)) &&
      /^https?:\/\//.test(c.url),
  );
  res.json(await classifyCaptures(valid));
});

export default router;
