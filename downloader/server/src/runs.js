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

// A submit for a section already running or parked joins that run instead of starting a second
// driver over the same rows — two drivers would re-trigger every remaining row concurrently.
export function startRun(args) {
  const active = runs.get(args.sectionId);
  if (active && (active.status === 'running' || active.status === 'paused')) return active.id;
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
// `trigger` is the seam the tests drive the queue through; production always uses `downloadItem`.
export async function drive(run, from, trigger = downloadItem) {
  run.status = 'running';
  run.paused = null;
  broadcastRuns();
  try {
    for (let i = from; i < run.targets.length; i++) {
      if (!isCurrent(run)) return;
      // A stretch of caller-decided rows needs no work at all: skip to its end and broadcast once,
      // since every frame costs each connected client a `GET /runs`.
      while (i + 1 < run.targets.length && run.targets[i].disposition !== 'pending') i++;
      const target = run.targets[i];
      run.at = i + 1;
      broadcastRuns();
      if (target.disposition !== 'pending') continue;

      // Contained per target: a malformed answer from auto/ fails this row, never the whole run.
      let outcome = { disposition: 'queue-failed' };
      let body = null;
      try {
        const res = await trigger({
          ref: target.ref,
          course: run.course,
          name: target.name,
          kind: target.kind,
        });
        body = res.body;
        outcome = outcomeFor(res.status);
      } catch {
        /* keep the queue-failed default */
      }
      if (!isCurrent(run)) return;

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
  } catch {
    // Nothing outside a target's own work is expected to throw; abandoning the run is still better
    // than leaving it `running` forever, which would disable the section's button until a restart.
    run.status = 'cancelled';
  }
  run.paused = null;
  broadcastRuns();
}
