// The launch-secret boundary, driven against a real express app on a real loopback port. A
// hand-rolled req/res would make the query-form cases assertions about the fake rather than about
// express's own parser, which is the whole point of them.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { peerHeaders, requireSecret, statePath } from '../runtime.js';

const SECRET = 's3cr3t';
const HEADER = 'X-FastStudy-Secret';

const app = express();
app.use(requireSecret);
app.get('/health', (req, res) => res.json({ ok: true }));
app.post('/health', (req, res) => res.json({ ok: true }));
app.get('/events', (req, res) => res.json({ ok: true }));
app.get('/thing', (req, res) => res.json({ ok: true }));

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const originalSecret = process.env.FASTSTUDY_SECRET;
const originalStateDir = process.env.FASTSTUDY_STATE_DIR;

after(() => {
  server.close();
  restore('FASTSTUDY_SECRET', originalSecret);
  restore('FASTSTUDY_STATE_DIR', originalStateDir);
});

// requireSecret reads the env on every call, so a test only has to set it — no re-listen between cases.
function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function get(pathname, init) {
  return fetch(`${origin}${pathname}`, init);
}

test('an unset FASTSTUDY_SECRET enforces nothing at all — that is dev', async () => {
  delete process.env.FASTSTUDY_SECRET;
  assert.equal((await get('/thing')).status, 200);
});

test('GET /health answers without the secret', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  assert.equal((await get('/health')).status, 200);
});

test('POST /health is not exempt — the exemption is GET-only', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  assert.equal((await get('/health', { method: 'POST' })).status, 401);
});

test('the correct header passes', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  assert.equal((await get('/thing', { headers: { [HEADER]: SECRET } })).status, 200);
});

test('the correct query parameter passes — EventSource cannot set a header', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  assert.equal((await get(`/thing?secret=${SECRET}`)).status, 200);
});

test('a wrong header does not shadow a correct query parameter', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  const response = await get(`/thing?secret=${SECRET}`, { headers: { [HEADER]: 'nope' } });
  assert.equal(response.status, 200);
});

test('a wrong header alone is rejected', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  assert.equal((await get('/thing', { headers: { [HEADER]: 'nope' } })).status, 401);
});

test('no credential at all is rejected', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  assert.equal((await get('/thing')).status, 401);
});

test('an absent header hits the typeof guard rather than throwing inside Buffer.from', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  // req.get() returns undefined here; a 500 would mean the guard was dropped and Buffer.from threw.
  assert.equal((await get('/thing')).status, 401);
});

test('a different-length secret is rejected before timingSafeEqual, which throws on unequal buffers', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  const response = await get('/thing', { headers: { [HEADER]: 'x' } });
  assert.equal(response.status, 401);
  // Still serving: a throw inside the middleware would have taken the connection, not just the request.
  assert.equal((await get('/health')).status, 200);
});

test('a repeated ?secret= is rejected — express parses it to an array', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  // req.query.secret is ["s3cr3t","junk"], which the typeof guard rejects.
  assert.equal((await get(`/thing?secret=${SECRET}&secret=junk`)).status, 401);
  assert.equal((await get(`/thing?secret=junk&secret=${SECRET}`)).status, 401);
});

test('a bracketed ?secret[a]= is rejected', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  // Under express 5's default `simple` query parser the key is literally "secret[a]", so
  // req.query.secret is undefined — it does not parse to an object, which is express 4's `extended`.
  assert.equal((await get(`/thing?secret[a]=${SECRET}`)).status, 401);
});

test('an SSE 401 still looks like a stream and writes nothing into it', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  const response = await get('/events', { headers: { Accept: 'text/event-stream' } });
  assert.equal(response.status, 401);
  assert.ok(response.headers.get('content-type').startsWith('text/event-stream'));
  assert.equal(await response.text(), '');
});

test('a non-SSE 401 is JSON', async () => {
  process.env.FASTSTUDY_SECRET = SECRET;
  const response = await get('/thing');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

test('peerHeaders carries the secret only when there is one, and merges without mutating', () => {
  delete process.env.FASTSTUDY_SECRET;
  assert.deepEqual(peerHeaders(), {});

  process.env.FASTSTUDY_SECRET = SECRET;
  assert.deepEqual(peerHeaders(), { [HEADER]: SECRET });

  const caller = { 'Content-Type': 'application/json' };
  assert.deepEqual(peerHeaders(caller), { 'Content-Type': 'application/json', [HEADER]: SECRET });
  assert.deepEqual(caller, { 'Content-Type': 'application/json' });
});

test('statePath falls back to .state at the repo root', () => {
  delete process.env.FASTSTUDY_STATE_DIR;
  const root = statePath();
  assert.equal(path.basename(root), '.state');
  // The root is identified by markers rather than an absolute path, so this survives a checkout
  // anywhere and still fails if this folder's depth below the repo root ever drifts.
  const parent = path.dirname(root);
  assert.ok(fs.existsSync(path.join(parent, 'package.json')));
  assert.ok(fs.existsSync(path.join(parent, 'CLAUDE.md')));
});

test('an explicit FASTSTUDY_STATE_DIR is honored and multi-part joins land under it', () => {
  const dir = path.join(os.tmpdir(), 'faststudy-state-test');
  process.env.FASTSTUDY_STATE_DIR = dir;
  assert.equal(statePath('a', 'b'), path.join(dir, 'a', 'b'));
});

test('statePath creates nothing — a pure join', () => {
  const dir = path.join(os.tmpdir(), `faststudy-state-${process.pid}-nowhere`);
  process.env.FASTSTUDY_STATE_DIR = dir;
  const joined = statePath('a', 'b');
  assert.ok(!fs.existsSync(joined));
  assert.ok(!fs.existsSync(path.dirname(joined)));
  assert.ok(!fs.existsSync(dir));
});
