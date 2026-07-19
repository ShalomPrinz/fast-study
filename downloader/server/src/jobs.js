import { randomUUID } from 'node:crypto';
import { measureBytes } from './progress.js';

// HTTP-pollable mirror of the terminal progress registry (docs/JOBS.md): a browser
// can't watch stdout, so every download is also a job here. Bytes are measured on
// READ from the same temp-dir entry the renderer polls — no second measurement path.
const jobs = new Map();

// Finished jobs linger so a poller reliably observes the terminal state before eviction.
const RETENTION_MS = 5 * 60 * 1000;

// Created SYNCHRONOUSLY by the route, before the async size probe, so a client that
// polls with the id it just received can never miss the job.
export function createJob({ course, lecture, kind, tool }) {
  const id = randomUUID();
  jobs.set(id, {
    id, course, lecture, kind, tool,
    status: 'queued', expectedBytes: null, receivedBytes: 0, message: null, entry: null,
  });
  return id;
}

// null when the probe couldn't determine a size — the consumer shows bytes, not a percent.
export function setExpectedBytes(id, bytes) {
  const job = jobs.get(id);
  if (job) job.expectedBytes = bytes || null;
}

// The child is live: bytes now come from `entry`, the same object the renderer measures.
export function startJob(id, entry) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'running';
  job.entry = entry;
}

// Take the final measurement while the temp dir still exists — the upload deletes it.
export function freezeJobBytes(id) {
  const job = jobs.get(id);
  if (!job) return;
  job.receivedBytes = liveBytes(job);
  job.entry = null;
}

// First terminal call wins: a spawn failure fires both 'error' and 'close', and the
// 'error' handler carries the real reason.
export function finishJob(id, status, message = null) {
  const job = jobs.get(id);
  if (!job || job.status === 'done' || job.status === 'error') return;
  freezeJobBytes(id);
  job.status = status;
  job.message = message;
  setTimeout(() => jobs.delete(id), RETENTION_MS).unref();
}

function liveBytes(job) {
  return job.entry ? measureBytes(job.entry) : job.receivedBytes;
}

function snapshot(job) {
  const { id, status, course, lecture, kind, tool, expectedBytes, message } = job;
  return { id, status, course, lecture, kind, tool, expectedBytes, message, receivedBytes: liveBytes(job) };
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

export function listJobs(ids = null) {
  const wanted = ids ? new Set(ids) : null;
  return [...jobs.values()].filter((j) => !wanted || wanted.has(j.id)).map(snapshot);
}
