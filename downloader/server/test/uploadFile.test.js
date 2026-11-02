// POST /upload-file: filename validation, forwarding to the database's /materials with the original
// name, and General mode keeping the original extension. A loopback stand-in database records posts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const posts = [];
const peer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'POST' && req.url.includes('/materials')) {
      posts.push({ url: new URL(req.url, 'http://x'), type: req.headers['content-type'] });
      return res.end(JSON.stringify({ name: 'material.pptx' }));
    }
    res.end('{}');
  });
});
await new Promise((r) => peer.listen(0, '127.0.0.1', r));
process.env.DATABASE_URL = `http://127.0.0.1:${peer.address().port}`;
process.env.FASTSTUDY_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-file-state-'));

const { default: router, parseFilename } = await import('../src/routes/pdf.js');
const { writeFolder } = await import('../src/generalFolder.js');
const app = express();
app.use(router);
const server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-file-out-'));
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  server.close();
  peer.closeAllConnections();
  peer.close();
  fs.rmSync(process.env.FASTSTUDY_STATE_DIR, { recursive: true, force: true });
});
test.beforeEach(() => {
  posts.length = 0;
});

const post = (query, body = 'bytes') =>
  fetch(`${base}/upload-file?${query}`, { method: 'POST', body });

test('parseFilename needs a name with a supported extension, any case', () => {
  assert.equal(parseFilename(undefined).body.params.field, 'filename');
  assert.equal(parseFilename('  ').body.code, 'invalid_request');
  assert.equal(parseFilename('a.exe').body.params.field, 'filename');
  assert.equal(parseFilename('noext').body.params.field, 'filename');
  assert.deepEqual(parseFilename('Week 1.PPTX'), {
    filename: 'Week 1.PPTX',
    ext: '.pptx',
    stem: 'Week 1',
  });
});

test('an unsupported or missing filename is a 400 before anything is sent', async () => {
  for (const q of ['course=C&lecture=latest', 'course=C&lecture=latest&filename=x.zip']) {
    const res = await post(q);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).params.field, 'filename');
  }
  assert.equal(posts.length, 0);
});

test('app mode forwards the original name and a fitting content type', async () => {
  const res = await post('course=C&lecture=latest&filename=Week%201.pptx');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'File uploaded', target: 'C/latest' });
  const material = posts.find((p) => p.url.pathname.endsWith('/materials'));
  assert.equal(material.url.searchParams.get('filename'), 'Week 1.pptx');
  assert.match(material.type, /presentationml\.presentation$/);
});

test('app mode still needs course and lecture', async () => {
  const res = await post('filename=a.pdf');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).params.field, 'course');
});

test('General mode writes <name>.<original ext>, never overwriting', async () => {
  writeFolder(dir);
  const first = await (await post('dest=folder&filename=Week%201.pptx', 'one')).json();
  const second = await (await post('dest=folder&filename=Week%201.PPTX', 'two')).json();
  assert.equal(first.fileName, 'Week 1.pptx');
  assert.equal(second.fileName, 'Week 1 (2).pptx');
  assert.equal(fs.readFileSync(path.join(dir, 'Week 1.pptx'), 'utf8'), 'one');
  assert.equal(posts.length, 0);
});

test('General mode refuses a traversal name and an empty body', async () => {
  assert.equal((await post('dest=folder&filename=..%2Fx.pptx')).status, 400);
  assert.equal((await post('dest=folder&filename=a.pptx', '')).status, 400);
});

test('General mode names the filename field on a traversal name', async () => {
  const body = await (await post('dest=folder&filename=..%2Fx.pptx')).json();
  assert.equal(body.params.field, 'filename');
  assert.match(body.error, /^filename /);
});

test('a database network error answers 500 instead of crashing', async () => {
  peer.closeAllConnections();
  await new Promise((r) => peer.close(r));
  const res = await post('course=C&lecture=latest&filename=a.pptx');
  assert.equal(res.status, 500);
});
