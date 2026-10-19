import { Router } from 'express';
import { BOOT_ID, cancelJob, hasJob, listJobs } from '../jobs.js';
import { subscribe } from '../events.js';

const router = Router();

// `/events` is how a consumer follows downloads and section runs.
// `?picker=1` marks the stream of a window that can open a native folder picker (`folder:pick`).
router.get('/events', (req, res) => subscribe(res, { picker: req.query.picker === '1' }));

// Stop one job, app or folder; the runner ends it `cancelled` (docs/JOBS.md). A job already
// terminal is left as it is, so a late click is a harmless 200.
router.post('/jobs/:id/cancel', (req, res) => {
  if (!hasJob(req.params.id))
    return res.status(404).json({ error: 'unknown job', code: 'job_unknown', params: {} });
  cancelJob(req.params.id);
  res.json({});
});

// `/jobs` is how a consumer resyncs after subscribing late or reconnecting (docs/JOBS.md).
router.get('/jobs', (req, res) => {
  res.json({ boot: BOOT_ID, jobs: listJobs() });
});

export default router;
