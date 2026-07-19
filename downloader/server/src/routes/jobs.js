import { Router } from 'express';
import { getJob, listJobs } from '../jobs.js';

const router = Router();

// Raw bytes only — percent is the consumer's business (and must stay clamped ≤99%
// until the job is terminal; see docs/JOBS.md).

router.get('/jobs', (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  res.json({ jobs: listJobs(ids) });
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'unknown job' });
  res.json(job);
});

export default router;
