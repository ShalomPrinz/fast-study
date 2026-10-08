// A video link on the Moodle host is one plain file, so it resolves to a `curl` target on auto's
// proxy route — never yt-dlp, and never a direct fetch. A local stand-in plays the Moodle host.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-videoproxy-'));
process.env.FASTSTUDY_STATE_DIR = STATE_DIR;
process.on('exit', () => fs.rmSync(STATE_DIR, { recursive: true, force: true }));

import express from 'express';
import { setCurrentSite } from '../src/moodle/site.js';
import { handleMoodleFile, handleMoodleFileHead, handleResolve } from '../src/http/server.js';
import { encodeRef } from '../src/lib/ref.js';
import './gated.js';

const VIDEO = Buffer.from('\x00\x00\x00\x18ftypmp42 stand-in video bytes');
const CHALLENGE = '<html><body>Please verify you are human</body></html>';

// The Moodle host: each path answers as one kind of link would.
function standIn(req, res) {
  const html = () => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.method === 'HEAD' ? undefined : CHALLENGE);
  };
  const file = (type) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const from = m ? Number(m[1]) : 0;
    const to = m && m[2] ? Number(m[2]) : VIDEO.length - 1;
    const body = VIDEO.subarray(from, to + 1);
    res.writeHead(m ? 206 : 200, {
      'Content-Type': type,
      'Content-Length': String(body.length),
      ...(m ? { 'Content-Range': `bytes ${from}-${to}/${VIDEO.length}` } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (req.url.startsWith('/page/')) return html();
  if (req.url === '/media/lecture.mp4') return file('video/mp4');
  if (req.url === '/media/opaque.mp4') return file('application/octet-stream');
  // A bot challenge: headers and a ranged byte look like the video, the full GET is the wall.
  if (req.url === '/trap/lecture.mp4') {
    return req.method === 'HEAD' || req.headers.range ? file('video/mp4') : html();
  }
  res.writeHead(404).end();
}

const moodle = http.createServer(standIn);
await new Promise((r) => moodle.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${moodle.address().port}`;
setCurrentSite(SITE);

const app = express();
app.use(express.json());
app.post('/resolve', handleResolve);
app.head('/moodle/file/:id', handleMoodleFileHead);
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

// What server/ sends for a row of a section run: it waits its turn at the lock.
const WAIT = { 'X-FastStudy-Moodle-Wait': '1' };

async function resolveLink(pathname, name) {
  const ref = encodeRef({ strategy: 'direct-url', pageUrl: `${SITE}${pathname}`, kind: 'lecture' });
  const res = await fetch(`${AUTO}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...WAIT },
    body: JSON.stringify({ ref, course: 'C', name, kind: 'lecture', forceCapture: true }),
  });
  return { status: res.status, body: await res.json() };
}

test('a Moodle-host link that answers HTML is refused, with no target', async () => {
  const { status, body } = await resolveLink('/page/syllabus', 'H1');
  assert.equal(status, 422);
  assert.equal(body.code, 'link_not_a_video');
  assert.equal(body.targets, undefined);
});

for (const [label, pathname] of [
  ['video/mp4', '/media/lecture.mp4'],
  ['application/octet-stream on a .mp4 path', '/media/opaque.mp4'],
]) {
  test(`a Moodle-host video (${label}) is a curl target on auto that streams the exact bytes`, async () => {
    const { status, body } = await resolveLink(pathname, `V-${label.length}`);
    assert.equal(status, 200);
    assert.equal(body.media, 'video');
    const [target] = body.targets;
    assert.equal(target.tool, 'curl');
    assert.deepEqual(target.headers, []);
    assert.match(target.url, /^\/moodle\/file\/[0-9a-f-]{36}$/);

    const streamed = await fetch(`${AUTO}${target.url}`, { headers: WAIT });
    assert.equal(streamed.status, 200);
    assert.deepEqual(Buffer.from(await streamed.arrayBuffer()), VIDEO);
  });
}

test('a video whose full GET is a bot challenge is 503 site_blocked, never the HTML', async () => {
  const { status, body } = await resolveLink('/trap/lecture.mp4', 'T1');
  assert.equal(status, 200);
  assert.equal(body.targets[0].tool, 'curl');

  const streamed = await fetch(`${AUTO}${body.targets[0].url}`, { headers: WAIT });
  assert.equal(streamed.status, 503);
  const text = await streamed.text();
  assert.equal(text.includes('verify you are human'), false);
  assert.equal(JSON.parse(text).code, 'site_blocked');
});
