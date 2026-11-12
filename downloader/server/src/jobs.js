import { randomUUID } from 'node:crypto';
import { measureBytes } from './progress.js';
import { broadcastJobs } from './events.js';
import { operationForTool } from './services/timing.js';

// The download registry a consumer outside this process can read (docs/JOBS.md).
const jobs = new Map();

// Per-process id: a client tells a restart (jobs gone) from an eviction by it changing.
export const BOOT_ID = randomUUID();

// A `done` job lingers only to bridge the sub-second gap until the database tree SSE flips
// the frontend row green — the tree, not the job, owns the durable "downloaded" state.
export const DONE_BRIDGE_MS = 60 * 1000;

// No new bytes for this long on a running transfer marks a job `stalled` (docs/JOBS.md).
export const STALL_MS = 30 * 1000;
const STALL_CHECK_MS = 5 * 1000;
let stallTimer = null;

// Created SYNCHRONOUSLY by the route, before the size probe, so a resync with the new id finds it.
// A folder job has no course/lecture/kind; `fileName` is the requested stem until saved (docs/JOBS.md).
export function createJob({
  course = null,
  lecture = null,
  kind = null,
  media = null,
  tool,
  ref = null,
  fromCache = false,
  dest = 'app',
  folder = null,
  fileName = null,
  source = 'other',
  inRun = false,
  restart = null,
}) {
  // A retry supersedes any terminal predecessor for this target so `/jobs` holds at most
  // one job per target.
  supersedeTerminal({ course, lecture, kind, media, ref, dest, folder, fileName });
  const id = randomUUID();
  jobs.set(id, {
    id,
    course,
    lecture,
    kind,
    media,
    tool,
    ref,
    fromCache,
    dest,
    folder,
    fileName,
    // Off the wire: the supersede key, which must not move when `fileName` becomes the saved name.
    requested: fileName,
    source,
    // Off the wire: a section-run job is never restartable alone; `restart` re-launches this request from zero.
    inRun,
    restart,
    stalled: false,
    lastBytes: 0,
    progressAt: null,
    storing: false,
    status: 'queued',
    expectedBytes: null,
    startedAt: null,
    receivedBytes: 0,
    message: null,
    code: null,
    params: null,
    entry: null,
    // Not on the wire: a cancel aborts it, and the runner kills the child or skips the spawn.
    abort: new AbortController(),
  });
  broadcastJobs(); // a queued job must ping so the frontend row flips to in-flight
  return id;
}

// null when the probe couldn't determine a size — the consumer then has no ETA basis.
export function setExpectedBytes(id, bytes) {
  const job = jobs.get(id);
  if (job) job.expectedBytes = bytes || null;
}

// The child is live: bytes now come from `entry`, the same object the renderer measures.
// Emitted here rather than at create time so `expectedBytes` (the probe) is already known.
export function startJob(id, entry) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'running';
  job.entry = entry;
  job.startedAt = Date.now();
  job.lastBytes = 0;
  job.progressAt = job.startedAt;
  job.stalled = false;
  stallTimer ??= setInterval(checkStalls, STALL_CHECK_MS).unref();
  broadcastJobs();
}

// Flags a running transfer whose measured bytes have not grown for STALL_MS, counted from the spawn
// so a host that never sends a byte stalls too. Only the transfer is judged: after the child exits
// the entry is gone, and a total at or past the probed size is yt-dlp's merge. One ping per change.
export function checkStalls(now = Date.now()) {
  let changed = false;
  for (const job of jobs.values()) {
    let stalled = false;
    if (job.status === 'running' && job.entry && !job.inRun) {
      const bytes = liveBytes(job);
      if (bytes !== job.lastBytes) {
        if (bytes > job.lastBytes) job.progressAt = now;
        job.lastBytes = bytes;
      }
      const merging = job.expectedBytes && bytes >= job.expectedBytes;
      if (merging) job.progressAt = now;
      stalled = !merging && now - job.progressAt >= STALL_MS;
    }
    if (stalled !== job.stalled) {
      job.stalled = stalled;
      changed = true;
    }
  }
  if (changed) broadcastJobs();
}

// Stops the stall timer once no job is `running`, so an idle server never wakes; `startJob` re-arms it.
function disarmStallTimerIfIdle() {
  if (!stallTimer) return;
  for (const job of jobs.values()) if (job.status === 'running') return;
  clearInterval(stallTimer);
  stallTimer = null;
}

// Whether the stall timer is ticking.
export function stallTimerArmed() {
  return stallTimer !== null;
}

// The child exited clean and the bytes are going to the database: past the point a restart can abort.
export function markStoring(id) {
  const job = jobs.get(id);
  if (job) job.storing = true;
}

// Start a running or queued single job over from zero (also one between attempts, in a retry or
// re-resolve wait): abort the child or the wait (the runner removes the partial temp dir), drop the old job, and launch the same request as a NEW job. The old id leaves
// `/jobs` at once, so its runner's late terminal call finds nothing. Returns `{id}` or `{code}`.
export function restartJob(id) {
  const job = jobs.get(id);
  if (!job) return { code: 'job_unknown' };
  if (job.inRun) return { code: 'job_in_run' };
  if (terminal(job) || job.storing || !job.restart) return { code: 'job_not_restartable' };
  job.abort.abort();
  removeJob(id);
  return { id: job.restart() };
}

// The name a folder job's file was saved under, set just before it turns `done`.
export function setJobFileName(id, fileName) {
  const job = jobs.get(id);
  if (job) job.fileName = fileName;
}

// Whether `id` names a job still on `/jobs`.
export function hasJob(id) {
  return jobs.has(id);
}

// The signal the runner hands to `spawn` and to a re-resolve; null for an unknown job.
export function jobSignal(id) {
  return jobs.get(id)?.abort.signal ?? null;
}

// Ask a live job to stop. The runner owns the terminal transition (`cancelled`) — a job already
// uploading never checks the signal again, so its upload finishes and it ends `done` or `error`.
export function cancelJob(id) {
  const job = jobs.get(id);
  if (!terminal(job)) job.abort.abort();
}

// Take the final measurement while the temp dir still exists — the upload deletes it.
export function freezeJobBytes(id) {
  const job = jobs.get(id);
  if (!job) return 0;
  job.receivedBytes = liveBytes(job);
  job.entry = null;
  job.stalled = false;
  return job.receivedBytes;
}

// done/error/cancelled are terminal; a missing (already-reaped) job counts as terminal too.
function terminal(job) {
  return !job || job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
}

// A failure terminates with its machine `code` and flat `params` beside the English `message`
// (repo-root `docs/ERROR-CODES.md`); a `done` or `cancelled` job carries none of the three.
export function finishJob(id, status, message = null, code = null, params = null) {
  const job = jobs.get(id);
  if (terminal(job)) return;
  freezeJobBytes(id);
  job.status = status;
  job.stalled = false;
  job.message = message;
  job.code = code;
  job.params = params;
  disarmStallTimerIfIdle();
  broadcastJobs();
  // Only `done` is evicted on a timer; `error`/`cancelled` stay until a retry supersedes them.
  // Ids are fresh UUIDs, so a late timer for a superseded job finds nothing and stays silent.
  if (status === 'done') setTimeout(() => evict(id), DONE_BRIDGE_MS).unref();
}

// Evict any terminal predecessor (`done`, `error` or `cancelled`) to guarantee one job per target.
// A folder job's target is folder + requested name, so it never matches an app job's course/lecture.
function supersedeTerminal({ course, lecture, kind, media, ref, dest, folder, fileName }) {
  for (const [id, job] of jobs) {
    if (!terminal(job) || job.dest !== dest) continue;
    const same =
      dest === 'folder'
        ? job.folder === folder && job.requested === fileName
        : job.ref === ref &&
          job.course === course &&
          job.lecture === lecture &&
          job.kind === kind &&
          job.media === media;
    if (same) evict(id);
  }
}

function evict(id) {
  if (removeJob(id)) broadcastJobs();
}

// The one way a job leaves the registry: a running one dropped here must not keep the stall timer alive.
function removeJob(id) {
  const removed = jobs.delete(id);
  disarmStallTimerIfIdle();
  return removed;
}

function liveBytes(job) {
  return job.entry ? measureBytes(job.entry) : job.receivedBytes;
}

function snapshot(job) {
  const { id, status, course, lecture, kind, media, tool, ref, expectedBytes, startedAt } = job;
  const { message, code, params, dest, folder, fileName, source, stalled } = job;
  return {
    id,
    status,
    course,
    lecture,
    kind,
    media,
    tool,
    ref,
    dest,
    folder,
    fileName,
    operation: operationForTool(tool),
    expectedBytes,
    startedAt,
    stalled,
    source,
    message,
    code,
    params,
  };
}

export function listJobs() {
  return [...jobs.values()].map(snapshot);
}
