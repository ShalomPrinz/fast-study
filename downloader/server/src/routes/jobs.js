import { Router } from 'express';
import { listJobs } from '../jobs.js';
import { subscribe } from '../events.js';

const router = Router();

// `/events` is how a consumer follows downloads
router.get('/events', (req, res) => subscribe(res));

// `/jobs` is how a consumer resyncs after subscribing late or reconnecting (docs/JOBS.md).
router.get('/jobs', (req, res) => {
  res.json({ jobs: listJobs() });
});

export default router;
