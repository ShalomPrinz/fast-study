// Moodle files reach server/ through auto: /resolve hands out a path on auto, never the tokened
// URL, and GET /moodle/file/:id streams it under the lock with Range passed through.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-file-'));
process.env.FASTSTUDY_STATE_DIR = STATE_DIR;
process.on('exit', () => fs.rmSync(STATE_DIR, { recursive: true, force: true }));

import express from 'express';
import { setCurrentSite } from '../src/moodle/site.js';
import { writeTokenFile } from '../src/auth/tokenStore.js';
import { handleMoodleFile, handleMoodleFileHead, handleResolve } from '../src/http/server.js';
import { encodeRef } from '../src/lib/ref.js';
import { moodleGate } from '../src/moodle/gate.js';
import { proxyCap } from '../src/moodle/files.js';
import { gated } from './gated.js';
import { probeUrl } from '../src/lib/probeUrl.js';
import { resolveDirectUrl } from '../src/core/core.js';

const SITE = 'https://moodle.test';
const FILEURL = `${SITE}/webservice/pluginfile.php/9/mod_resource/content/1/notes.pdf`;
const PDF = Buffer.from('%PDF-1.4 hello');

setCurrentSite(SITE);
writeTokenFile(path.join(STATE_DIR, 'auth', 'moodle-token.json'), {
  site: SITE,
  wstoken: 'secret-wstoken',
  userid: 7,
});

async function serve(t) {
  const app = express();
  app.use(express.json());
  app.post('/resolve', handleResolve);
  app.head('/moodle/file/:id', handleMoodleFileHead);
  app.get('/moodle/file/:id', handleMoodleFile);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

// Moodle's pluginfile: honours a Range, records what it was asked.
function stubMoodle(t, base) {
  const asked = [];
  const local = fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith(base)) return local(url, init);
    asked.push({ url: String(url), range: init?.headers?.Range ?? null });
    const type = String(url).split('?')[0].endsWith('.mp4') ? 'video/mp4' : 'application/pdf';
    const m = /bytes=(\d+)-(\d*)/.exec(init?.headers?.Range ?? '');
    if (!m) {
      return new Response(PDF, {
        status: 200,
        headers: { 'content-type': type, 'content-length': String(PDF.length) },
      });
    }
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : PDF.length - 1;
    return new Response(PDF.subarray(from, to + 1), {
      status: 206,
      headers: {
        'content-type': type,
        'content-range': `bytes ${from}-${to}/${PDF.length}`,
      },
    });
  });
  return { asked, local };
}

test('a Moodle file resolves to a path on auto, and streams through it whole or ranged', async (t) => {
  const base = await serve(t);
  const { asked, local } = stubMoodle(t, base);
  const ref = encodeRef({ strategy: 'moodle-file', fileurl: FILEURL, kind: 'lecture' });
  const resolved = await local(`${base}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, course: 'C', name: 'L1', kind: 'lecture' }),
  });
  assert.equal(resolved.status, 200);
  const { media, targets } = await resolved.json();
  assert.equal(media, 'material');
  assert.equal(targets.length, 1);
  const [target] = targets;
  assert.match(target.url, /^\/moodle\/file\/[0-9a-f-]{36}$/);
  assert.equal(target.tool, 'fetch');
  assert.equal(target.fromCache, true);
  assert.equal(JSON.stringify(targets).includes('secret-wstoken'), false);

  const preflights = asked.length;
  const head = await local(`${base}${target.url}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(PDF.length));
  assert.equal(asked.length, preflights, 'HEAD is answered without asking Moodle');

  const whole = await local(`${base}${target.url}`);
  assert.equal(whole.status, 200);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), PDF);
  assert.match(asked.at(-1).url, /token=secret-wstoken/);

  const part = await local(`${base}${target.url}`, { headers: { Range: 'bytes=5-' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 5-${PDF.length - 1}/${PDF.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), PDF.subarray(5));
  assert.equal(asked.at(-1).range, 'bytes=5-');
});

test('an id this process never minted is 401, so server/ re-resolves instead of saving a body', async (t) => {
  const base = await serve(t);
  const head = await fetch(`${base}/moodle/file/not-an-id`, { method: 'HEAD' });
  assert.equal(head.status, 401);
  const res = await fetch(`${base}/moodle/file/not-an-id`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'moodle_file_unknown');
});

test('a frontend /resolve is refused 429 moodle_busy while the lock is held; a waiting one is not', async (t) => {
  const base = await serve(t);
  const { local } = stubMoodle(t, base);
  let lease;
  await moodleGate.run({}, async () => {
    lease = await moodleGate.hold();
  });
  const ref = encodeRef({ strategy: 'moodle-file', fileurl: FILEURL, kind: 'lecture' });
  const post = (headers = {}) =>
    local(`${base}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ref, course: 'C', name: 'L2', kind: 'lecture' }),
    });
  const refused = await post();
  assert.equal(refused.status, 429);
  assert.deepEqual(await refused.json(), {
    status: 'busy',
    error: 'another Moodle request is running; try again once it ends',
    code: 'moodle_busy',
    params: {},
  });

  const waiting = post({ 'X-FastStudy-Moodle-Wait': '1' });
  await new Promise((r) => setTimeout(r, 50));
  lease.release();
  assert.equal((await waiting).status, 200);
});

test('a link on the Moodle host streams through auto too, as curl, its size known up front', async (t) => {
  const base = await serve(t);
  const { asked, local } = stubMoodle(t, base);
  const ref = encodeRef({
    strategy: 'direct-url',
    pageUrl: `${SITE}/media/lecture-01.mp4`,
    kind: 'lecture',
  });
  const resolved = await local(`${base}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FastStudy-Moodle-Wait': '1' },
    body: JSON.stringify({ ref, course: 'C', name: 'L3', kind: 'lecture' }),
  });
  const { media, targets } = await resolved.json();
  assert.equal(media, 'video');
  assert.deepEqual(
    { tool: targets[0].tool, headers: targets[0].headers, fromCache: targets[0].fromCache },
    { tool: 'curl', headers: [], fromCache: true },
  );
  assert.match(targets[0].url, /^\/moodle\/file\//);
  const head = await local(`${base}${targets[0].url}`, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(PDF.length));

  const body = await local(`${base}${targets[0].url}`, {
    headers: { 'X-FastStudy-Moodle-Wait': '1' },
  });
  assert.deepEqual(Buffer.from(await body.arrayBuffer()), PDF);
  assert.equal(asked.at(-1).url, `${SITE}/media/lecture-01.mp4`, 'fetched as it is, no token');
});

test('a captured file replays its own headers from auto, never a captured Range or Host', async (t) => {
  const base = await serve(t);
  const { local } = stubMoodle(t, base);
  let sent;
  const inner = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (!String(url).startsWith(base)) sent = init.headers;
    return inner(url, init);
  });
  const cap = proxyCap({
    url: `${SITE}/videostream/lecture.mp4`,
    headers: [
      { name: 'Cookie', value: 'MoodleSession=abc' },
      { name: 'Range', value: 'bytes=500-' },
      { name: 'Host', value: 'moodle.test' },
    ],
  });
  await (
    await local(`${base}${cap.url}`, { headers: { 'X-FastStudy-Moodle-Wait': '1' } })
  ).arrayBuffer();
  assert.deepEqual(sent, { Cookie: 'MoodleSession=abc' });
});

test('a link that redirects onto the Moodle host is gated at that hop, and proxied', async (t) => {
  const answers = {
    'https://short.test/r': { status: 302, headers: { location: `${SITE}/media/redirected.mp4` } },
    [`${SITE}/media/redirected.mp4`]: { status: 200, headers: { 'content-type': 'video/mp4' } },
  };
  t.mock.method(globalThis, 'fetch', async (url) => {
    const a = answers[String(url)];
    return new Response(null, a);
  });
  // Outside any request the Moodle hop is refused, not mistaken for a verdict about the link.
  const escaped = await probeUrl('https://short.test/r', { force: true }).catch((e) => e);
  assert.equal(escaped.code, 'moodle_call_ungated');

  const [target] = await gated(() =>
    resolveDirectUrl({
      recording: { pageUrl: 'https://short.test/r', strategy: 'direct-url', kind: 'lecture' },
      course: 'C',
      name: 'R1',
      kind: 'lecture',
      forceCapture: true,
    }),
  ).then((r) => r.targets);
  assert.match(target.url, /^\/moodle\/file\//);
  assert.equal(target.tool, 'curl');
});
