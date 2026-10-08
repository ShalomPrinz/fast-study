// The edge to auto/: /resolve over node:http (a waiting call outlives undici's 300s headers timeout),
// its failure codes, and Moodle files fetched from auto with the secret and the wait marker, which
// curl reads from a file rather than argv. auto is a local stand-in; nothing leaves loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// The stand-in's behaviour per test; it records what each request carried.
let answer = (req, res) => res.end();
const seen = [];
const auto = http.createServer((req, res) => {
  seen.push({ path: req.url, wait: req.headers['x-faststudy-moodle-wait'] ?? null });
  answer(req, res);
});
await new Promise((r) => auto.listen(0, '127.0.0.1', r));
test.after(() => {
  auto.closeAllConnections();
  auto.close();
});

process.env.AUTODL_URL = `http://127.0.0.1:${auto.address().port}`;
process.env.FASTSTUDY_SECRET = 'launch-secret';
const { AUTODL_URL } = await import('../src/config.js');
const { onAutodl, resolve, targetUrl } = await import('../src/services/autodl.js');
const { downloadItem } = await import('../src/routes/downloadItem.js');
const { fetchFile } = await import('../src/downloaders/fetch.js');
const { listJobs } = await import('../src/jobs.js');
const { curl } = await import('../src/downloaders/curl.js');

const json = (status, body) => (req, res) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

test('a waiting resolve is marked, and keeps waiting however long auto holds it', async () => {
  // Headers come only after a long hold — fetch's own cutoff is 300s; this proves no cutoff of
  // ours sits in front of it, at a length a test can afford.
  answer = (req, res) =>
    setTimeout(() => json(200, { media: 'material', targets: [] })(req, res), 1500);
  seen.length = 0;
  const { status, body } = await resolve({
    ref: 'r',
    course: 'C',
    name: 'L',
    kind: 'lecture',
    wait: true,
  });
  assert.equal(status, 200);
  assert.equal(body.media, 'material');
  assert.deepEqual(seen, [{ path: '/resolve', wait: '1' }]);

  seen.length = 0;
  await resolve({ ref: 'r', course: 'C', name: 'L', kind: 'lecture' });
  assert.deepEqual(seen, [{ path: '/resolve', wait: null }], 'a button press is never marked');
});

test('an abandoned wait leaves auto (the request closes) and starts no job', async () => {
  let closed;
  const gone = new Promise((r) => (closed = r));
  answer = (req, res) => {
    res.on('close', closed); // auto's gate drops a queued caller on exactly this
  };
  const stop = new AbortController();
  const pending = downloadItem({
    ref: 'r',
    course: 'Abandoned',
    name: 'L',
    kind: 'lecture',
    wait: true,
    signal: stop.signal,
  });
  await new Promise((r) => setTimeout(r, 50));
  stop.abort();
  await gone;
  assert.deepEqual(await pending, { status: 0, body: null });
  assert.equal(listJobs().filter((j) => j.course === 'Abandoned').length, 0);
});

test("a button press's 429 moodle_busy is forwarded verbatim", async () => {
  const busy = { status: 'busy', error: 'busy', code: 'moodle_busy', params: {} };
  answer = json(429, busy);
  assert.deepEqual(await downloadItem({ ref: 'r', course: 'C', name: 'L', kind: 'lecture' }), {
    status: 429,
    body: busy,
  });
});

test('an unreachable auto/ is one code whichever half produced the body', async () => {
  answer = (req) => req.socket.destroy();
  const { status, body } = await resolve({ ref: 'r', course: 'C', name: 'L', kind: 'lecture' });
  assert.equal(status, 0);
  assert.equal(body.code, 'autodl_unreachable');
  assert.equal(typeof body.params.detail, 'string');

  // The other shape: auto answered a non-2xx with nothing parseable.
  answer = (req, res) => {
    res.writeHead(502);
    res.end('not json');
  };
  assert.deepEqual(await downloadItem({ ref: 'r', course: 'C', name: 'L', kind: 'lecture' }), {
    status: 502,
    body: {
      error: 'auto-downloader unreachable',
      code: 'autodl_unreachable',
      params: { detail: 'HTTP 502' },
    },
  });
});

test('a 2xx with nothing runnable is its own code', async () => {
  answer = json(200, { media: 'video', targets: [] });
  const { status, body } = await downloadItem({
    ref: 'r',
    course: 'C',
    name: 'L',
    kind: 'lecture',
  });
  assert.equal(status, 502);
  assert.deepEqual(body, {
    error: 'auto returned no usable target',
    code: 'autodl_no_target',
    params: {},
  });
});

test('a relative target is a URL on auto; an absolute one is left alone', () => {
  assert.equal(targetUrl('/moodle/file/abc'), new URL('/moodle/file/abc', AUTODL_URL).toString());
  assert.equal(targetUrl('https://cdn.test/a.pdf'), 'https://cdn.test/a.pdf');
  assert.equal(onAutodl(targetUrl('/moodle/file/abc')), true);
  assert.equal(onAutodl('https://cdn.test/a.pdf'), false);
});

const HEADER_LINES = 'X-FastStudy-Moodle-Wait: 1\nX-FastStudy-Secret: launch-secret\n';

for (const [label, downloader] of [
  ['fetch', fetchFile],
  ['curl', curl],
]) {
  test(`${label} fetches a file on auto with the secret and the wait marker, never on argv`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-hdr-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { args } = downloader.buildCommand(
      { url: targetUrl('/moodle/file/abc'), headers: [] },
      dir,
    );
    assert.equal(args.join(' ').includes('launch-secret'), false);
    assert.deepEqual(args.slice(0, 2), ['-H', '@request-headers.txt']);
    assert.equal(fs.readFileSync(path.join(dir, 'request-headers.txt'), 'utf8'), HEADER_LINES);
  });

  test(`${label} sends any other URL none of auto's headers`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-plain-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { args } = downloader.buildCommand({ url: 'https://cdn.test/a.mp4', headers: [] }, dir);
    assert.equal(args.join(' ').includes('Moodle-Wait'), false);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
}
