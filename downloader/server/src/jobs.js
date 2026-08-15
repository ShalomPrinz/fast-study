import { randomUUID } from 'node:crypto';
import { measureBytes } from './progress.js';
import { broadcast } from './events.js';
import { operationForTool } from './services/timing.js';

// The download registry a consumer outside this process can read (docs/JOBS.md).
const jobs = new Map();

// A `done` job lingers only to bridge the sub-second gap until the database tree SSE flips
// the frontend row green — the tree, not the job, owns the durable "downloaded" state.
const DONE_BRIDGE_MS = 60 * 1000;

// Created SYNCHRONOUSLY by the route, before the async size probe, so a client that
// resyncs with the id it just received can never miss the job.
export function createJob({ course, lecture, kind, tool, ref = null, fromCache = false }) {
  // A retry supersedes any terminal predecessor for this target so `/jobs` holds at most
  // one job per target.
  supersedeTerminal({ course, lecture, kind, ref });
  const id = randomUUID();
  jobs.set(id, {
    id,
    course,
    lecture,
    kind,
    tool,
    ref,
    fromCache,
    status: 'queued',
    expectedBytes: null,
    startedAt: null,
    receivedBytes: 0,
    message: null,
    entry: null,
  });
  broadcast(); // a queued job must ping so the frontend row flips to in-flight
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
  broadcast();
}

// Take the final measurement while the temp dir still exists — the upload deletes it.
export function freezeJobBytes(id) {
  const job = jobs.get(id);
  if (!job) return 0;
  job.receivedBytes = liveBytes(job);
  job.entry = null;
  return job.receivedBytes;
}

// done/error are terminal; a missing (already-reaped) job counts as terminal too.
function terminal(job) {
  return !job || job.status === 'done' || job.status === 'error';
}

export function finishJob(id, status, message = null) {
  const job = jobs.get(id);
  if (terminal(job)) return;
  freezeJobBytes(id);
  job.status = status;
  job.message = message;
  broadcast();
  // Delete after short timeout. See @docs/JOBS.md.
  if (status === 'done') setTimeout(() => jobs.delete(id), DONE_BRIDGE_MS).unref();
}

// Evict any terminal predecessor (`done` or `error`) to guarantee one job per target
function supersedeTerminal({ course, lecture, kind, ref }) {
  for (const [id, job] of jobs) {
    if (
      terminal(job) &&
      job.ref === ref &&
      job.course === course &&
      job.lecture === lecture &&
      job.kind === kind
    ) {
      evict(id);
    }
  }
}

function evict(id) {
  if (jobs.delete(id)) broadcast();
}

function liveBytes(job) {
  return job.entry ? measureBytes(job.entry) : job.receivedBytes;
}

function snapshot(job) {
  const { id, status, course, lecture, kind, tool, ref, expectedBytes, startedAt, message } = job;
  return {
    id,
    status,
    course,
    lecture,
    kind,
    tool,
    ref,
    operation: operationForTool(tool),
    expectedBytes,
    startedAt,
    message,
  };
}

export function listJobs() {
  return [...jobs.values()].map(snapshot);
}
