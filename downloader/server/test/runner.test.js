// A cancelled job: the child is killed (or never spawned), its partial file goes with the temp dir,
// and neither an upload nor a timing sample follows. The child is this node binary, never curl.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// A stand-in backend that counts `POST /timing` samples; set before the runner reads its config.
const samples = [];
const backend = http.createServer((req, res) => {
  if (req.url === '/timing') samples.push(req.method);
  req.resume();
  res.end('{}');
});
await new Promise((r) => backend.listen(0, '127.0.0.1', r));
process.env.BACKEND_URL = `http://127.0.0.1:${backend.address().port}`;
test.after(() => backend.close());

const { runDownloadJob } = await import('../src/downloaders/runner.js');
const { cancelJob, createJob, listJobs } = await import('../src/jobs.js');

const WRITE_THEN_HANG =
  "require('fs').writeFileSync('video.mp4', 'partial'); setInterval(() => {}, 1000)";

// A curl-shaped downloader whose child is `node -e script`; records what the runner did with it.
function fakeDownloader(script, { probe = async () => 7 } = {}) {
  const seen = { tempDir: null, built: false, uploads: 0 };
  const downloader = {
    tool: 'curl',
    measure: 'file',
    probeSize: probe,
    upload: async () => {
      seen.uploads += 1;
      return null;
    },
    buildCommand: (_input, tempDir) => {
      seen.built = true;
      seen.tempDir = tempDir;
      return { command: process.execPath, args: ['-e', script] };
    },
  };
  return { downloader, seen };
}

function job(id) {
  return listJobs().find((j) => j.id === id);
}

async function until(check) {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'condition never held');
}

function start(downloader, lecture) {
  const jobId = createJob({ course: 'C', lecture, kind: 'video', tool: 'curl' });
  runDownloadJob(
    downloader,
    { url: 'http://example.invalid/v.mp4' },
    {
      course: 'C',
      lecture,
      kind: 'video',
      jobId,
    },
  );
  return jobId;
}

test('a clean exit uploads and records one timing sample', async () => {
  const before = samples.length;
  const { downloader, seen } = fakeDownloader("require('fs').writeFileSync('video.mp4', 'x')");
  const id = start(downloader, 'clean');
  await until(() => job(id).status === 'done');
  assert.equal(seen.uploads, 1);
  await until(() => samples.length === before + 1);
});

test('cancelling a running job kills the child and leaves no file, upload or sample', async () => {
  const before = samples.length;
  const { downloader, seen } = fakeDownloader(WRITE_THEN_HANG);
  const id = start(downloader, 'running');
  await until(() => seen.tempDir && fs.existsSync(path.join(seen.tempDir, 'video.mp4')));
  assert.equal(job(id).status, 'running');

  cancelJob(id);
  await until(() => job(id).status === 'cancelled');
  const { message, code, params } = job(id);
  assert.deepEqual({ message, code, params }, { message: null, code: null, params: null });
  assert.ok(!fs.existsSync(seen.tempDir), 'the partial download goes with the temp dir');
  assert.equal(seen.uploads, 0);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(samples.length, before);
});

test('a job cancelled before its spawn never spawns', async () => {
  let release;
  const probing = new Promise((r) => (release = r));
  const { downloader, seen } = fakeDownloader(WRITE_THEN_HANG, { probe: () => probing });
  const id = start(downloader, 'queued');
  assert.equal(job(id).status, 'queued');

  cancelJob(id);
  release(7);
  await until(() => job(id).status === 'cancelled');
  assert.equal(seen.built, false);
  assert.equal(job(id).startedAt, null);
});
