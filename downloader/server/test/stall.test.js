// Stall flag and single-job restart (docs/JOBS.md). Children are this node binary, never curl.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { subscribe } from '../src/events.js';
import {
  checkStalls,
  createJob,
  freezeJobBytes,
  listJobs,
  restartJob,
  setExpectedBytes,
  cancelJob,
  finishJob,
  jobSignal,
  startJob as markRunning,
  STALL_MS,
} from '../src/jobs.js';
import { startJob } from '../src/routes/download.js';

const job = (id) => listJobs().find((j) => j.id === id);

function fakeStream() {
  const res = Object.assign(new EventEmitter(), { pings: 0 });
  res.writeHead = () => {};
  res.write = (frame) => {
    if (frame.startsWith('event: job:change')) res.pings += 1;
  };
  subscribe(res);
  return res;
}

// A running job reading bytes off a real temp file, the way the runner's entry does.
function runningJob(t, extra = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const id = createJob({
    course: 'C',
    lecture: `L${Math.random()}`,
    kind: 'video',
    tool: 'curl',
    ...extra,
  });
  markRunning(id, { tempDir, measure: 'file' });
  const grow = (bytes) => fs.writeFileSync(path.join(tempDir, 'video.mp4'), Buffer.alloc(bytes));
  return { id, grow, at: job(id).startedAt };
}

test('a running job stalls after 30s without new bytes, and recovers when they grow', (t) => {
  const res = fakeStream();
  t.after(() => res.emit('close'));
  const { id, grow, at } = runningJob(t);
  assert.equal(job(id).stalled, false);
  assert.equal(job(id).source, 'other');

  checkStalls(at + STALL_MS - 1);
  assert.equal(job(id).stalled, false);
  const pings = res.pings;
  checkStalls(at + STALL_MS); // never a first byte
  assert.equal(job(id).stalled, true);
  assert.equal(res.pings, pings + 1);
  checkStalls(at + STALL_MS + 5000);
  assert.equal(res.pings, pings + 1, 'no ping while the flag is unchanged');

  grow(100);
  checkStalls(at + STALL_MS + 6000);
  assert.equal(job(id).stalled, false);
  assert.equal(res.pings, pings + 2);
  checkStalls(at + STALL_MS + 6000 + STALL_MS - 1);
  assert.equal(job(id).stalled, false, 'the clock restarted at the growth');
  checkStalls(at + 2 * STALL_MS + 6000);
  assert.equal(job(id).stalled, true);
});

test('no stall flag once the transfer is over', (t) => {
  const { id, at } = runningJob(t);
  checkStalls(at + STALL_MS);
  assert.equal(job(id).stalled, true);
  freezeJobBytes(id); // the child exited; the file now goes to the database
  assert.equal(job(id).stalled, false);
  checkStalls(at + 10 * STALL_MS);
  assert.equal(job(id).stalled, false);

  // yt-dlp's merge: the child still runs but everything probed is already on disk.
  const merging = runningJob(t);
  merging.grow(50);
  setExpectedBytes(merging.id, 50);
  checkStalls(merging.at + 10 * STALL_MS);
  assert.equal(job(merging.id).stalled, false);
});

test('a section-run job never stalls', (t) => {
  const { id, at } = runningJob(t, { inRun: true });
  checkStalls(at + 10 * STALL_MS);
  assert.equal(job(id).stalled, false);
});

const HANG = "require('fs').writeFileSync('video.mp4', 'partial'); setInterval(() => {}, 1000)";

async function until(check) {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'condition never held');
}

test('restart aborts the child, drops the partial file and re-runs the same request from zero', async () => {
  const dirs = [];
  const inputs = [];
  const downloader = {
    tool: 'curl',
    measure: 'file',
    probeSize: async () => 7,
    upload: async () => null,
    buildCommand: (input, tempDir) => {
      dirs.push(tempDir);
      inputs.push(input);
      return { command: process.execPath, args: ['-e', HANG] };
    },
  };
  const input = { url: 'http://example.invalid/v.mp4', headers: [{ name: 'X', value: '1' }] };
  const first = startJob(downloader, input, { course: 'C', lecture: 'R1', kind: 'video' });
  await until(() => job(first)?.status === 'running');
  await until(() => fs.existsSync(path.join(dirs[0], 'video.mp4')));

  const { id: second, code } = restartJob(first);
  assert.equal(code, undefined);
  assert.notEqual(second, first);
  assert.equal(job(first), undefined, 'the old id leaves /jobs');
  await until(() => job(second)?.status === 'running');
  assert.deepEqual(inputs[1], input);
  assert.notEqual(dirs[1], dirs[0]);
  await until(() => !fs.existsSync(dirs[0]));
  assert.deepEqual(
    listJobs()
      .filter((j) => j.lecture === 'R1')
      .map((j) => j.id),
    [second],
  );
  restartJob(second);
  await until(() => dirs.length === 3);
  const last = listJobs().find((j) => j.lecture === 'R1');
  await until(() => job(last.id)?.status === 'running');
  cancelJob(last.id);
  await until(() => job(last.id)?.status === 'cancelled');
});

test('restart is refused for run jobs and unknown ids', () => {
  assert.deepEqual(restartJob('nope'), { code: 'job_unknown' });
  const inRun = createJob({
    course: 'C',
    lecture: 'RunJob',
    kind: 'video',
    tool: 'curl',
    inRun: true,
    restart: () => 'x',
  });
  assert.deepEqual(restartJob(inRun), { code: 'job_in_run' });
  assert.equal(job(inRun).status, 'queued');
  assert.equal(jobSignal(inRun).aborted, false);
});

test('restart is refused for a finished job', () => {
  const id = createJob({
    course: 'C',
    lecture: 'Done',
    kind: 'video',
    tool: 'curl',
    restart: () => 'x',
  });
  finishJob(id, 'error', 'x', 'download_tool_failed', {});
  assert.deepEqual(restartJob(id), { code: 'job_not_restartable' });
});

test('a restarted job keeps its source', async () => {
  const downloader = {
    tool: 'curl',
    measure: 'file',
    probeSize: async () => 7,
    upload: async () => null,
    buildCommand: () => ({ command: process.execPath, args: ['-e', HANG] }),
  };
  const first = startJob(
    downloader,
    { url: 'http://example.invalid/v.mp4' },
    { course: 'C', lecture: 'Src', kind: 'video', moodle: true },
  );
  await until(() => job(first)?.status === 'running');
  const { id: second } = restartJob(first);
  assert.equal(job(second).source, 'moodle');
  await until(() => job(second)?.status === 'running');
  cancelJob(second);
  await until(() => job(second)?.status === 'cancelled');
});

const REFUSED_403 =
  "console.error('curl: (22) The requested URL returned error: 403'); process.exit(22)";

test('restart during the re-resolve wait succeeds and the pending retry never spawns', async () => {
  let spawned = 0;
  const failing = {
    tool: 'curl',
    measure: 'file',
    probeSize: async () => 7,
    upload: async () => null,
    buildCommand: () => ({ command: process.execPath, args: ['-e', REFUSED_403] }),
  };
  const retry = {
    ...failing,
    buildCommand: () => {
      spawned += 1;
      return { command: process.execPath, args: ['-e', HANG] };
    },
  };
  let release;
  const waiting = new Promise((r) => (release = r));
  let calls = 0;
  const reresolve = () => {
    calls += 1;
    return calls > 1
      ? new Promise(() => {})
      : waiting.then(() => ({ downloader: retry, input: { url: 'http://example.invalid/v.mp4' } }));
  };
  const first = startJob(
    failing,
    { url: 'http://example.invalid/v.mp4' },
    { course: 'C', lecture: 'Wait', kind: 'video', fromCache: true, reresolve },
  );
  await until(() => calls === 1);
  const { id: second, code } = restartJob(first);
  assert.equal(code, undefined);
  assert.notEqual(second, first);
  release();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(spawned, 0, 'the superseded job never launches its retry');
  assert.equal(job(first), undefined);
  cancelJob(second);
});

test('restart is refused while the job is storing into the database', async () => {
  let release;
  const stored = new Promise((r) => (release = r));
  const downloader = {
    tool: 'curl',
    measure: 'file',
    probeSize: async () => 7,
    upload: () => stored.then(() => null),
    buildCommand: () => ({
      command: process.execPath,
      args: ['-e', "require('fs').writeFileSync('video.mp4', 'x')"],
    }),
  };
  const id = startJob(
    downloader,
    { url: 'http://example.invalid/v.mp4' },
    { course: 'C', lecture: 'Storing', kind: 'video' },
  );
  await until(() => job(id)?.status === 'running');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(restartJob(id), { code: 'job_not_restartable' });
  release();
  await until(() => job(id)?.status === 'done');
});
