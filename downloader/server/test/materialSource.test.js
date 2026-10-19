// A material downloaded from a discovery row posts its ref as `source`, verbatim; every other
// material upload posts none. A loopback stand-in database (and backend, for the timing sample)
// records each query; the job's child is this node binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const posts = [];
const peer = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (req.method === 'POST' && req.url.includes('/materials')) {
      posts.push(new URL(req.url, 'http://x'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ name: 'material.pdf' }));
    }
    res.end('{}');
  });
});
await new Promise((r) => peer.listen(0, '127.0.0.1', r));
test.after(() => {
  peer.closeAllConnections();
  peer.close();
});
process.env.DATABASE_URL = `http://127.0.0.1:${peer.address().port}`;
process.env.BACKEND_URL = process.env.DATABASE_URL;

const { uploadMaterial, uploadPdf } = await import('../src/services/database.js');
const { startJob } = await import('../src/routes/download.js');
const { listJobs } = await import('../src/jobs.js');

// base64url's `-`/`_` plus `+`, `/` and `=` that a careless join would mangle.
const REF = 'eyJ0aXRsZSI6IkwxIn0-_+/=';

test.beforeEach(() => {
  posts.length = 0;
});

function tempWithPdf() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-study-src-'));
  fs.writeFileSync(path.join(dir, 'material.pdf'), '%PDF-1.4');
  return dir;
}

async function until(check) {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'condition never held');
}

// A fetch-shaped downloader whose child writes the PDF; its upload is the real uploadMaterial.
const pdfDownloader = {
  tool: 'fetch',
  measure: 'dir',
  probeSize: async () => 8,
  upload: uploadMaterial,
  buildCommand: () => ({
    command: process.execPath,
    args: ['-e', "require('fs').writeFileSync('material.pdf', '%PDF-1.4')"],
  }),
};

test('uploadMaterial posts the source verbatim, and none without one', async () => {
  assert.equal(await uploadMaterial(tempWithPdf(), 'C', 'L1', 'lecture', 'fetch', REF), null);
  assert.equal(await uploadMaterial(tempWithPdf(), 'C', 'L1', 'lecture', 'fetch'), null);
  assert.equal(posts[0].searchParams.get('source'), REF);
  assert.equal(posts[0].searchParams.get('kind'), 'lecture');
  assert.equal(posts[1].searchParams.has('source'), false);
});

test('uploadPdf, the extension path, posts no source', async () => {
  assert.equal(await uploadPdf(Buffer.from('%PDF-1.4'), 'C', 'L1', 'lecture'), null);
  assert.equal(posts[0].searchParams.has('source'), false);
});

test("a job started with a row's ref uploads its material with that ref as source", async () => {
  const id = startJob(
    pdfDownloader,
    { url: 'http://example.invalid/a.pdf' },
    {
      course: 'C',
      lecture: 'L1',
      kind: 'lecture',
      ref: REF,
    },
  );
  await until(() => listJobs().find((j) => j.id === id)?.status === 'done');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].searchParams.get('source'), REF);
});

test('a job started with no ref (/download-file, /download-url) uploads no source', async () => {
  const id = startJob(
    pdfDownloader,
    { url: 'http://example.invalid/b.pdf' },
    {
      course: 'C',
      lecture: 'L2',
      kind: 'lecture',
    },
  );
  await until(() => listJobs().find((j) => j.id === id)?.status === 'done');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].searchParams.has('source'), false);
});
