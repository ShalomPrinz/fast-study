import { Router } from 'express';
import { probeContentLength } from '../services/probe.js';

const router = Router();

// The popup calls this because fetch strips the captured Cookie header the probe needs.
router.post('/probe-size', async (req, res) => {
  const { url, headers } = req.body ?? {};
  const bytes = await probeContentLength(url, headers);
  res.json({ bytes });
});

export default router;
