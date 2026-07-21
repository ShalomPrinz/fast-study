import { randomUUID } from 'node:crypto';
import { measureBytes } from './progress.js';
import { broadcast } from './events.js';

// The download registry a consumer outside this process can read (docs/JOBS.md).
const jobs = new Map();

// Finished jobs linger so a client that reconnects late still sees the terminal state.
const RETENTION_MS = 5 * 60 * 1000;

// Created SYNCHRONOUSLY by the route, before the async size probe, so a client that
// resyncs with the id it just received can never miss the job.
export function createJob({ course, lecture, kind, tool }) {
  const id = randomUUID();
  jobs.set(id, {
    id, course, lecture, kind, tool,
    status: 'queued', expectedBytes: null, startedAt: null,
    receivedBytes: 0, message: null, entry: null,
  });
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
  const { course, lecture, kind, tool, expectedBytes, startedAt } = job;
  broadcast('job:start', { id, course, lecture, kind, tool, expectedBytes, startedAt });
}

// Take the final measurement while the temp dir still exists — the upload deletes it.
export function freezeJobBytes(id) {
  const job = jobs.get(id);
  if (!job) return 0;
  job.receivedBytes = liveBytes(job);
  job.entry = null;
  return job.receivedBytes;
}

// First terminal call wins: a spawn failure fires both 'error' and 'close', and the
// 'error' handler carries the real reason.
export function finishJob(id, status, message = null) {
  const job = jobs.get(id);
  if (!job || job.status === 'done' || job.status === 'error') return;
  freezeJobBytes(id);
  job.status = status;
  job.message = message;
  broadcast('job:end', { id, status, message });
  setTimeout(() => jobs.delete(id), RETENTION_MS).unref();
}

function liveBytes(job) {
  return job.entry ? measureBytes(job.entry) : job.receivedBytes;
}

function snapshot(job) {
  const { id, status, course, lecture, kind, tool, expectedBytes, startedAt, message } = job;
  return { id, status, course, lecture, kind, tool, expectedBytes, startedAt, message };
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

export function listJobs() {
  return [...jobs.values()].map(snapshot);
}
