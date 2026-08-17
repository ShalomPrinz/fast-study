import { Router } from 'express';
import { cancelRun, getRun, listRuns, resumeRun, startRun } from '../runs.js';
import { storedName, validateKind } from '../validate.js';

const router = Router();

// A submitted target, exactly the frontend's `RunTarget` (docs/RUNS.md — change one, change the
// other). Only `disposition` may be absent: the caller sets it just for a row it already decided.
function targetError(target) {
  if (typeof target?.ref !== 'string' || !target.ref) return 'each target needs a valid ref';
  if (!storedName(target.name)) return 'each target needs a name with a legal character';
  return validateKind(target.kind)?.error ?? null;
}

// Start (or restart) this section's bulk run, or join the one already in flight. Answers the run id
// immediately — the queue is driven in the background and followed over `/events` + `GET /runs`.
router.post('/download-section', (req, res) => {
  const { sectionId, course, targets } = req.body ?? {};
  if (typeof sectionId !== 'string' || !sectionId) {
    return res.status(400).json({ error: 'valid sectionId required' });
  }
  const storedCourse = storedName(course);
  if (!storedCourse) {
    return res.status(400).json({ error: 'course with a legal character is required' });
  }
  if (!Array.isArray(targets) || !targets.length) {
    return res.status(400).json({ error: 'targets must be a non-empty array' });
  }
  for (const target of targets) {
    const error = targetError(target);
    if (error) return res.status(400).json({ error });
  }
  // The run carries the stored spelling from here on, so its targets, job titles and PUTs all
  // agree with disk; `renames` tells the caller which rows it must re-label.
  const canonical = targets.map((target) => ({ ...target, name: storedName(target.name) }));
  const renames = canonical
    .filter((target, i) => target.name !== targets[i].name)
    .map(({ ref, name }) => ({ ref, name }));
  res.json({
    runId: startRun({ sectionId, course: storedCourse, targets: canonical }),
    renames,
  });
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
