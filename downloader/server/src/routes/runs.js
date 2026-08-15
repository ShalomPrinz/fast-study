import { Router } from 'express';
import { cancelRun, getRun, listRuns, resumeRun, startRun } from '../runs.js';
import { isSafeName, validateKind } from '../validate.js';

const router = Router();

// A submitted target, exactly the frontend's `RunTarget` (docs/RUNS.md — change one, change the
// other). Only `disposition` may be absent: the caller sets it just for a row it already decided.
function targetError(target) {
  if (typeof target?.ref !== 'string' || !target.ref) return 'each target needs a valid ref';
  if (!isSafeName(target.name)) return 'each target needs a name';
  return validateKind(target.kind)?.error ?? null;
}

// Start (or restart) this section's bulk run, or join the one already in flight. Answers the run id
// immediately — the queue is driven in the background and followed over `/events` + `GET /runs`.
router.post('/download-section', (req, res) => {
  const { sectionId, course, targets } = req.body ?? {};
  if (typeof sectionId !== 'string' || !sectionId) {
    return res.status(400).json({ error: 'valid sectionId required' });
  }
  if (!isSafeName(course)) return res.status(400).json({ error: 'course is required' });
  if (!Array.isArray(targets) || !targets.length) {
    return res.status(400).json({ error: 'targets must be a non-empty array' });
  }
  for (const target of targets) {
    const error = targetError(target);
    if (error) return res.status(400).json({ error });
  }
  res.json({ runId: startRun({ sectionId, course, targets }) });
});

// Continue a run parked at a passcode gate. The passcode itself is saved through auto's
// `POST /zoom/passcode` first — the passcode store stays in auto/.
router.post('/runs/:id/resume', (req, res) => {
  if (!getRun(req.params.id)) return res.status(404).json({ error: 'unknown run' });
  // 409: the run exists but isn't parked — a double submit, which must not re-enter the driver.
  const error = resumeRun(req.params.id, { skip: req.body?.skip === true });
  if (error) return res.status(409).json({ error });
  res.json({});
});

router.post('/runs/:id/cancel', (req, res) => {
  const error = cancelRun(req.params.id);
  if (error) return res.status(404).json({ error });
  res.json({});
});

// How a consumer resyncs after subscribing late or reloading mid-run (docs/RUNS.md).
router.get('/runs', (req, res) => {
  res.json({ runs: listRuns() });
});

export default router;
