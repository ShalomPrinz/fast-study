import { Router } from 'express';
import { probeContentLength } from '../services/probe.js';
import {
  probeHlsBytes,
  classifyCaptures,
  MAX_CAPTURES,
  MAX_MP4_CAPTURES,
} from '../services/hls.js';
import { invalidRequest } from '../validate.js';
import { isHlsUrl } from '../hlsPlaylist.js';

const router = Router();

// The popup calls this because fetch strips the captured Cookie header the probe needs.
// An HLS playlist url answers the master's estimated bytes (null for anything else).
router.post('/probe-size', async (req, res) => {
  const { url, headers } = req.body ?? {};
  const bytes = isHlsUrl(url)
    ? await probeHlsBytes(url, headers)
    : await probeContentLength(url, headers);
  res.json({ bytes });
});

// The popup's captured HLS playlist requests in, the streams worth offering out (docs/DOWNLOAD.md, "HLS").
router.post('/hls-streams', async (req, res) => {
  const { captures } = req.body ?? {};
  const tooMany =
    Array.isArray(captures) &&
    (captures.filter((c) => isHlsUrl(c?.url)).length > MAX_CAPTURES ||
      captures.filter((c) => !isHlsUrl(c?.url)).length > MAX_MP4_CAPTURES);
  if (!Array.isArray(captures) || tooMany) {
    return res
      .status(400)
      .json(
        invalidRequest(
          'captures',
          `captures must be an array of at most ${MAX_CAPTURES} HLS playlist and ${MAX_MP4_CAPTURES} other`,
        ),
      );
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
