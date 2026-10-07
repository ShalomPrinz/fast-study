import { Router } from 'express';
import { BOOT_ID, listJobs } from '../jobs.js';
import { subscribe } from '../events.js';

const router = Router();

// `/events` is how a consumer follows downloads and section runs.
router.get('/events', (req, res) => subscribe(res));

// `/jobs` is how a consumer resyncs after subscribing late or reconnecting (docs/JOBS.md).
router.get('/jobs', (req, res) => {
  res.json({ boot: BOOT_ID, jobs: listJobs() });
});

export default router;
