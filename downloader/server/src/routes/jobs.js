import { Router } from 'express';
import { BOOT_ID, cancelJob, hasJob, listJobs, restartJob } from '../jobs.js';
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

// Start one running or queued single job over from zero. `{jobId}` is a NEW id that supersedes the
// old one, which leaves `/jobs` at once (docs/JOBS.md).
router.post('/jobs/:id/restart', (req, res) => {
  const { id, code } = restartJob(req.params.id);
  if (id) return res.json({ jobId: id });
  const refusal = {
    job_unknown: [404, 'unknown job'],
    job_in_run: [409, 'job belongs to a section run'],
    job_not_restartable: [409, 'job is not restartable'],
  }[code];
  res.status(refusal[0]).json({ error: refusal[1], code, params: {} });
});

// `/jobs` is how a consumer resyncs after subscribing late or reconnecting (docs/JOBS.md).
router.get('/jobs', (req, res) => {
  res.json({ boot: BOOT_ID, jobs: listJobs() });
});

export default router;
