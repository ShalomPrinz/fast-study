import { randomUUID } from 'node:crypto';
import { broadcastRuns } from './events.js';
import { cancelJob } from './jobs.js';
import { downloadItem } from './routes/downloadItem.js';

// The section-run registry (docs/RUNS.md): one bulk "download all" per section, keyed by the
// section identity so a client that reloaded can find its run again with no id to remember.
const runs = new Map();

// The two refusals both the registry and its routes answer with (repo-root `docs/ERROR-CODES.md`).
export const UNKNOWN_RUN = { error: 'unknown run', code: 'run_unknown', params: {} };
export const RUN_NOT_PAUSED = { error: 'run is not paused', code: 'run_not_paused', params: {} };

/**
 * What an orchestrator status does to the run: `status` halts the run in that state, `disposition`
 * records it on the target and the queue continues (docs/RUNS.md).
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
function toTarget({ ref, name, kind, media, disposition, moodle }) {
  const decided = disposition === 'skipped' || disposition === 'unsupported';
  const target = { ref, name, kind, media, disposition: decided ? disposition : 'pending' };
  return moodle === true ? { ...target, moodle } : target;
}

// A row whose resolve ended with Moodle's captcha unsolved for 10 minutes (auto MOODLE.md).
const CAPTCHA_TIMEOUT = 'site_captcha_timeout';

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
  // Not on the wire: aborts the row in flight, which may sit in auto's Moodle queue indefinitely.
  Object.defineProperty(run, 'stop', { value: new AbortController() });
  // Not on the wire either: every job the run's rows started, so a cancel can stop them too.
  Object.defineProperty(run, 'jobIds', { value: [] });
  // Not on the wire: set once a row's captcha went unsolved, so the Moodle rows after it fail unsent.
  Object.defineProperty(run, 'captchaTimedOut', { value: false, writable: true });
  runs.get(sectionId)?.stop.abort();
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

// null on success, else the failure body — a resume is only meaningful on a run parked at a
// passcode gate, and re-entering the driver on a running one would download every remaining row twice.
export function resumeRun(id, { skip = false } = {}) {
  const run = getRun(id);
  if (!run) return UNKNOWN_RUN;
  if (run.status !== 'paused') return RUN_NOT_PAUSED;
  const { index } = run.paused;
  // A skipped gate records the row as failed to queue and moves on, rather than abandoning the
  // whole run.
  if (skip) run.targets[index].disposition = 'queue-failed';
  void drive(run, skip ? index + 1 : index);
  return null;
}

export function cancelRun(id) {
  const run = getRun(id);
  if (!run) return UNKNOWN_RUN;
  run.status = 'cancelled';
  run.paused = null;
  run.stop.abort();
  for (const jobId of run.jobIds) cancelJob(jobId);
  broadcastRuns();
  return null;
}

// Record the jobs a row started; one that lands after its run was cancelled is stopped at once.
function adoptJobs(run, jobIds) {
  for (const jobId of jobIds ?? []) {
    run.jobIds.push(jobId);
    if (run.status === 'cancelled') cancelJob(jobId);
  }
}

// A run stops the moment it is cancelled or replaced by a newer run for the same section — checked
// around every await, since the driver holds a reference the registry may already have dropped.
function isCurrent(run) {
  return runs.get(run.sectionId) === run && run.status !== 'cancelled';
}

// Trigger the queue sequentially from `from` — the downloads themselves still overlap. `trigger`
// is the tests' seam; production always uses `downloadItem`.
export async function drive(run, from, trigger = downloadItem) {
  run.status = 'running';
  run.paused = null;
  // A resume means the user is back, so the Moodle rows still pending are sent again.
  run.captchaTimedOut = false;
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
      // Once a row's captcha went unsolved, nobody is at the window: the Moodle rows left fail unsent.
      if (run.captchaTimedOut && target.moodle === true) {
        Object.assign(target, { disposition: 'queue-failed', code: CAPTCHA_TIMEOUT });
        broadcastRuns();
        continue;
      }

      // Contained per target: a malformed answer from auto/ fails this row, never the whole run.
      let outcome = { disposition: 'queue-failed' };
      let body = null;
      try {
        // The run walks on its own, so each row waits its turn at auto's Moodle lock.
        const res = await trigger({
          ref: target.ref,
          course: run.course,
          name: target.name,
          kind: target.kind,
          wait: true,
          signal: run.stop.signal,
        });
        body = res.body;
        outcome = outcomeFor(res.status);
        if (res.status === 503 && body?.code === CAPTCHA_TIMEOUT) {
          target.code = CAPTCHA_TIMEOUT;
          run.captchaTimedOut = true;
        }
        if (outcome.disposition === 'queued') adoptJobs(run, body?.jobIds);
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
      // On this row alone: its own zoom capture waited for the user to solve a captcha on screen.
      if (outcome.disposition === 'queued' && body?.captchaSolved === true)
        target.captchaSolved = true;
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
