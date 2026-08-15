import { randomUUID } from 'node:crypto';
import { broadcastRuns } from './events.js';
import { downloadItem } from './routes/downloadItem.js';

// The section-run registry (docs/RUNS.md): one bulk "download all" per section, keyed by the
// section identity so a client that reloaded can find its run again with no id to remember.
const runs = new Map();

/**
 * What an orchestrator status does to the run: `status` halts the run in that state, `disposition`
 * records it on the target and the queue continues. Mirrors what the frontend's client-side queue
 * has always done with the same four cases (docs/RUNS.md).
 */
export function outcomeFor(status) {
  if (status >= 200 && status < 300) return { disposition: 'queued' };
  if (status === 401) return { status: 'reconnect' };
  if (status === 409) return { status: 'paused' };
  if (status === 422) return { disposition: 'unsupported' };
  return { disposition: 'queue-failed' };
}

// The caller owns the skip rule (it reads the live course tree), so `skipped`/`unsupported` arrive
// already decided; anything else is undecided until the queue reaches it.
function toTarget({ ref, name, kind, media, disposition }) {
  const decided = disposition === 'skipped' || disposition === 'unsupported';
  return { ref, name, kind, media, disposition: decided ? disposition : 'pending' };
}

// Registering replaces any previous run for this section outright — one run per section is what
// keeps a run re-findable and removes any need for time-based eviction.
export function createRun({ sectionId, course, targets }) {
  const run = {
    id: randomUUID(),
    sectionId,
    course,
    targets: targets.map(toTarget),
    at: 0,
    total: targets.length,
    status: 'running',
    paused: null,
  };
  runs.set(sectionId, run);
  broadcastRuns();
  return run;
}

export function startRun(args) {
  const run = createRun(args);
  void drive(run, 0);
  return run.id;
}

export function listRuns() {
  return [...runs.values()];
}

export function getRun(id) {
  return listRuns().find((run) => run.id === id) ?? null;
}

// null on success, else the message — a resume is only meaningful on a run parked at a passcode
// gate, and re-entering the driver on a running one would download every remaining row twice.
export function resumeRun(id, { skip = false } = {}) {
  const run = getRun(id);
  if (!run) return 'unknown run';
  if (run.status !== 'paused') return 'run is not paused';
  const { index } = run.paused;
  // A skipped gate matches what a failed passcode save does today: the item is recorded as failed
  // to queue and the queue moves on, rather than the whole run being abandoned.
  if (skip) run.targets[index].disposition = 'queue-failed';
  void drive(run, skip ? index + 1 : index);
  return null;
}

export function cancelRun(id) {
  const run = getRun(id);
  if (!run) return 'unknown run';
  run.status = 'cancelled';
  run.paused = null;
  broadcastRuns();
  return null;
}

// A run stops the moment it is cancelled or replaced by a newer run for the same section — checked
// around every await, since the driver holds a reference the registry may already have dropped.
function isCurrent(run) {
  return runs.get(run.sectionId) === run && run.status !== 'cancelled';
}

// Trigger the queue sequentially from `from`. Sequential by design: auto/ serializes browser work
// per call anyway, and the downloads themselves run on, so several land in parallel regardless.
async function drive(run, from) {
  run.status = 'running';
  run.paused = null;
  broadcastRuns();
  for (let i = from; i < run.targets.length; i++) {
    if (!isCurrent(run)) return;
    const target = run.targets[i];
    run.at = i + 1;
    if (target.disposition !== 'pending') {
      broadcastRuns();
      continue;
    }
    broadcastRuns();
    const { status, body } = await downloadItem({
      ref: target.ref,
      course: run.course,
      name: target.name,
      kind: target.kind,
    });
    if (!isCurrent(run)) return;

    const outcome = outcomeFor(status);
    if (outcome.status === 'reconnect') {
      run.status = 'reconnect';
      broadcastRuns();
      return;
    }
    if (outcome.status === 'paused') {
      // Held indefinitely: the run owns no browser lock while parked, and a timeout would discard
      // work the user is one passcode away from resuming.
      run.status = 'paused';
      run.paused = { index: i, reason: body?.reason ?? 'missing', name: target.name };
      broadcastRuns();
      return;
    }
    target.disposition = outcome.disposition;
    // `media` is the POST's answer for a queued row — it says where on disk the file lands.
    if (outcome.disposition === 'queued') target.media = body?.media ?? target.media;
    if (outcome.disposition === 'unsupported') target.media = 'unsupported';
    broadcastRuns();
  }
  run.status = 'done';
  run.paused = null;
  broadcastRuns();
}
