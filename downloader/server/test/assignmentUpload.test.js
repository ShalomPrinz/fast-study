// A `media: 'assignment'` target is fetched like a material and posted to the database's
// assignment-files route; the only other call is the /timing sample, never a backend pipeline call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const calls = [];
const peer = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    calls.push({ method: req.method, url: new URL(req.url, 'http://x') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ assignment: 'A', name: 'f.pdf' }));
  });
});
await new Promise((r) => peer.listen(0, '127.0.0.1', r));
test.after(() => {
  peer.closeAllConnections();
  peer.close();
});
process.env.DATABASE_URL = `http://127.0.0.1:${peer.address().port}`;
process.env.BACKEND_URL = process.env.DATABASE_URL;

const { assignmentFilesUrl, uploadAssignmentFile } = await import('../src/services/database.js');
const { toRun } = await import('../src/routes/downloadItem.js');
const { startJob } = await import('../src/routes/download.js');
const { listJobs } = await import('../src/jobs.js');

const REF = 'eyJ0aXRsZSI6IkwxIn0-_+/=';

test('assignmentFilesUrl encodes course, assignment, filename and source', () => {
  const url = assignmentFilesUrl('Algo 1/2', 'מטלה 1 & 2', REF, 'a b.pdf');
  const u = new URL(url);
  assert.equal(
    u.pathname,
    '/courses/Algo%201%2F2/assignments/%D7%9E%D7%98%D7%9C%D7%94%201%20%26%202/files',
  );
  assert.equal(u.searchParams.get('filename'), 'a b.pdf');
  assert.equal(u.searchParams.get('source'), REF);
  assert.equal(new URL(assignmentFilesUrl('C', 'A')).search, '');
});

test('uploadAssignmentFile posts to the assignment-files route', async () => {
  calls.length = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-study-asg-'));
  fs.writeFileSync(path.join(dir, 'material.bin'), 'x');
  assert.equal(await uploadAssignmentFile(dir, 'C', 'A', 'fetch', REF, 'f.pdf'), null);
  const post = calls.find((c) => c.method === 'POST' && c.url.pathname.includes('/assignments/'));
  assert.equal(post.url.pathname, '/courses/C/assignments/A/files');
  assert.equal(post.url.searchParams.get('filename'), 'f.pdf');
});

test('toRun picks the assignment fetcher only for media assignment', () => {
  const target = { tool: 'fetch', url: 'http://example.invalid/x', filename: 'f.pdf' };
  assert.notEqual(toRun(target, 'assignment').downloader, toRun(target, 'material').downloader);
});

test('toRun refuses an assignment target that is not a fetch with a filename', () => {
  assert.equal(toRun({ tool: 'curl', url: 'http://example.invalid/x' }, 'assignment'), null);
  assert.equal(toRun({ tool: 'fetch', url: 'http://example.invalid/x' }, 'assignment'), null);
});

test('an assignment job uploads to the assignment route and calls no backend pipeline route', async () => {
  calls.length = 0;
  const { downloader, input } = toRun(
    { tool: 'fetch', url: 'http://example.invalid/x', filename: 'f.pdf' },
    'assignment',
  );
  const run = {
    ...downloader,
    probeSize: async () => 1,
    buildCommand: () => ({
      command: process.execPath,
      args: ['-e', "require('fs').writeFileSync('material.bin', 'x')"],
    }),
  };
  const id = startJob(run, input, { course: 'C', lecture: 'A', kind: 'lecture', ref: REF });
  for (let i = 0; i < 500 && listJobs().find((j) => j.id === id)?.status !== 'done'; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(listJobs().find((j) => j.id === id)?.status, 'done');
  const paths = calls.map((c) => c.url.pathname);
  assert.ok(paths.includes('/courses/C/assignments/A/files'));
  assert.ok(!paths.some((p) => p.includes('video-arrived') || p.includes('/materials')));
  assert.ok(
    paths.every((p) => p.includes('/assignments/') || p === '/notify' || p.includes('timing')),
  );
});
