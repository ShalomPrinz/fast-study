// A link pasted into the manual form: off the Moodle host it is a yt-dlp target with no network
// call; on it, a gated probe and a proxied curl target that never enters the replay cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-pasted-'));
process.env.FASTSTUDY_STATE_DIR = STATE_DIR;
process.on('exit', () => fs.rmSync(STATE_DIR, { recursive: true, force: true }));

import express from 'express';
import { setCurrentSite } from '../src/moodle/site.js';
import { handleMoodleFile, handleResolve } from '../src/http/server.js';
import { getCap } from '../src/core/replayCache.js';
import { moodleGate } from '../src/moodle/gate.js';
import './gated.js';

const VIDEO = Buffer.from('\x00\x00\x00\x18ftypmp42 pasted stand-in');
const hits = [];

// The Moodle host: a video, a PDF and a page.
const moodle = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url === '/media/lecture.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.length) });
    return res.end(req.method === 'HEAD' ? undefined : VIDEO);
  }
  if (req.url === '/media/notes.pdf') {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '4' });
    return res.end(req.method === 'HEAD' ? undefined : '%PDF');
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(req.method === 'HEAD' ? undefined : '<html></html>');
});
await new Promise((r) => moodle.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${moodle.address().port}`;
setCurrentSite(SITE);

const app = express();
app.use(express.json());
app.post('/resolve', handleResolve);
app.get('/moodle/file/:id', handleMoodleFile);
const auto = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const AUTO = `http://127.0.0.1:${auto.address().port}`;

test.after(() => {
  for (const s of [moodle, auto]) {
    s.closeAllConnections();
    s.close();
  }
});

const WAIT = { 'X-FastStudy-Moodle-Wait': '1' };

async function paste(url, name, headers = {}) {
  const res = await fetch(`${AUTO}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ url, course: 'C', name, kind: 'lecture' }),
  });
  return { status: res.status, body: await res.json() };
}

test('an off-site link is a yt-dlp target, with no network call from auto', async (t) => {
  const real = globalThis.fetch;
  const auto = (input, init) => real(input, init);
  // Only the test's own call to auto may go out; anything auto fetches would be a second call.
  let outbound = 0;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    if (String(input).startsWith(AUTO)) return auto(input, init);
    outbound++;
    throw new Error('auto must not fetch an off-site pasted link');
  });
  const { status, body } = await paste('https://videos.example.test/l1.mp4', 'Off');
  assert.equal(status, 200);
  assert.deepEqual(body, {
    media: 'video',
    targets: [
      { name: 'Off', tool: 'ytdlp', url: 'https://videos.example.test/l1.mp4', fromCache: false },
    ],
  });
  assert.equal(outbound, 0);
});

test('a Moodle-host video is a proxied curl target, and the replay cache stays empty', async () => {
  hits.length = 0;
  const { status, body } = await paste(`${SITE}/media/lecture.mp4`, 'On');
  assert.equal(status, 200);
  assert.equal(body.media, 'video');
  const [target] = body.targets;
  assert.equal(target.tool, 'curl');
  assert.match(target.url, /^\/moodle\/file\/[0-9a-f-]{36}$/);
  // A restart forgets the id, so server/ must be told it is worth a re-resolve.
  assert.equal(target.fromCache, true);
  assert.ok(hits.length > 0, 'the link was probed fresh');
  assert.equal(getCap('C', 'On', 'lecture', 'video'), null);

  const streamed = await fetch(`${AUTO}${target.url}`, { headers: WAIT });
  assert.deepEqual(Buffer.from(await streamed.arrayBuffer()), VIDEO);
});

for (const [label, pathname, ext] of [
  ['a PDF', '/media/notes.pdf', 'pdf'],
  ['a page', '/page/syllabus', null],
]) {
  test(`a Moodle-host link to ${label} is 422 link_not_a_video`, async () => {
    const url = `${SITE}${pathname}`;
    const { status, body } = await paste(url, `N-${label}`);
    assert.equal(status, 422);
    assert.equal(body.code, 'link_not_a_video');
    assert.deepEqual(body.params, { source: 'link', url, ext });
  });
}

test('a click while the lock is taken is 429 moodle_busy, before Moodle sees anything', async () => {
  let end;
  const ended = new Promise((r) => (end = r));
  const holder = moodleGate.run({}, async () => {
    await moodleGate.enter('x');
    await ended;
  });
  await new Promise((r) => setImmediate(r));
  hits.length = 0;
  const { status, body } = await paste(`${SITE}/media/lecture.mp4`, 'Busy');
  assert.equal(status, 429);
  assert.equal(body.code, 'moodle_busy');
  assert.deepEqual(hits, []);
  end();
  await holder;
});

test('a non-http(s) url is 400 invalid_request on url', async () => {
  const { status, body } = await paste('ftp://videos.example.test/l1.mp4', 'Bad');
  assert.equal(status, 400);
  assert.deepEqual(body.params, { field: 'url' });
});
