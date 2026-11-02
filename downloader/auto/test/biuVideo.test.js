// BIU's sidebar video block: the list endpoint's JSON-served-as-text/html reply, the rows it adds,
// and the /resolve HEAD against the object store. Fixtures and a stubbed fetch only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setCurrentSite } from '../src/moodle/site.js';
import { getVideoBlockEntries, WsBlockedError } from '../src/moodle/wsClient.js';
import { listRecordings } from '../src/core/core.js';
import { reachesMoodle } from '../src/core/registry.js';
import { biuVideoUrl, BIU_VIDEO_HOST } from '../src/extractors/BiuVideoExtractor.js';
import { handleResolve } from '../src/http/server.js';
import { encodeRef } from '../src/lib/ref.js';
import { gated } from './gated.js';

const SITE = 'https://lemida.biu.ac.il';
const FIXTURE = fs.readFileSync(
  path.join(import.meta.dirname, 'fixtures', 'biu-video-list.json'),
  'utf8',
);
const KEY = '99/99411e5fc3177f74f4c9b1075a67c19738176184';
const MP4 = `${BIU_VIDEO_HOST}/video_bucket/${KEY}.mp4`;
setCurrentSite(SITE);

const asHtml = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=UTF-8' } });

function stubFetch(t, answer) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: new URL(String(url)), init });
    return answer(new URL(String(url)), init);
  });
  return calls;
}

const list = () => gated(() => getVideoBlockEntries(SITE, '105515'));
const fail = (p) =>
  p.then(
    () => null,
    (e) => e,
  );

test('both arrays are read, and an entry with no filename is skipped', async (t) => {
  const calls = stubFetch(t, () => asHtml(FIXTURE));
  const entries = await list();
  assert.deepEqual(
    entries.map((e) => e.id),
    ['252087', '249927', '249928', '1111'],
  );
  const [{ url, init }] = calls;
  assert.equal(url.pathname, '/blocks/video/ajax/get_video_data_biu.php');
  assert.equal(url.searchParams.get('course'), 'course-105515');
  assert.equal(url.searchParams.has('wstoken'), false);
  assert.equal(JSON.stringify(init.headers).toLowerCase().includes('cookie'), false);
  const recs = listRecordings([], '105515', undefined, entries);
  assert.deepEqual(
    recs.map((r) => r.videoId),
    ['252087', '1111'],
  );
});

test('a row is a video, recitation by its title, with a ref made of the listing only', async (t) => {
  stubFetch(t, () => asHtml(FIXTURE));
  const recs = listRecordings([], '105515', undefined, await list());
  const [first] = recs;
  assert.deepEqual(first, {
    title: 'תרגול 2 - אוהד',
    kind: 'recitation',
    strategy: 'biu-video',
    section: '',
    courseId: '105515',
    videoId: '252087',
    objectKey: KEY,
    likelyRecording: true,
  });
  assert.equal(first.modifiedAt, 1731243698000);
  assert.equal(JSON.stringify(first).includes('modifiedAt'), false);
  assert.equal(recs[1].kind, 'lecture');
  const again = listRecordings([], '105515', undefined, await list());
  assert.equal(encodeRef(first), encodeRef(again[0]));
  assert.equal(reachesMoodle(first), false);
});

test('the bucket URL is built from the key and refuses a traversing one', () => {
  assert.equal(biuVideoUrl(KEY), MP4);
  for (const bad of ['', undefined, '../x', 'a/../b', '/a', 'a//b', 'a b', 'a?b=1'])
    assert.equal(biuVideoUrl(bad), null, String(bad));
});

test('JSON served as text/html is not a wall', async (t) => {
  stubFetch(t, () => asHtml('{"zoomvideos":[]}'));
  assert.deepEqual(await list(), []);
});

test('a captcha page and a redirect are walls', async (t) => {
  stubFetch(t, () => asHtml('<html>Radware Captcha Page</html>'));
  assert.ok((await fail(list())) instanceof WsBlockedError);
  t.mock.restoreAll();
  stubFetch(t, () => new Response(null, { status: 302, headers: { location: '/x' } }));
  assert.ok((await fail(list())) instanceof WsBlockedError);
});

test('a redirect to the site login is no block; another redirect stays a wall', async (t) => {
  for (const location of [`${SITE}/login/index.php`, '/login/index.php']) {
    stubFetch(t, () => new Response(null, { status: 303, headers: { location } }));
    assert.deepEqual(await list(), [], location);
    t.mock.restoreAll();
  }
  stubFetch(
    t,
    () => new Response(null, { status: 303, headers: { location: 'https://evil.example/login/' } }),
  );
  assert.ok((await fail(list())) instanceof WsBlockedError);
});

test('a 404 is a site without the block: no entries, no error', async (t) => {
  stubFetch(t, () => asHtml('<html>Not found</html>', 404));
  assert.deepEqual(await list(), []);
});

function fakeRes() {
  const res = {
    status(c) {
      res.code = c;
      return res;
    },
    json(b) {
      res.body = b;
      return res;
    },
    on() {},
  };
  return res;
}

async function resolve(t, { objectKey = KEY, name = 'biu', forceCapture = true } = {}) {
  t.mock.method(console, 'log', () => {});
  const ref = encodeRef({ strategy: 'biu-video', kind: 'recitation', objectKey, videoId: '1' });
  const res = fakeRes();
  await handleResolve({ body: { ref, course: 'C', name, kind: 'recitation', forceCapture } }, res);
  return res;
}

test('resolve HEADs the bucket only, then hands curl the URL with no headers', async (t) => {
  const calls = stubFetch(
    t,
    () => new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } }),
  );
  const res = await resolve(t, { name: 'ok' });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, {
    media: 'video',
    targets: [{ name: 'ok', tool: 'curl', url: MP4, headers: [], fromCache: false }],
  });
  assert.deepEqual(
    calls.map((c) => [c.init.method, c.url.href]),
    [['HEAD', MP4]],
  );
});

test('a second resolve replays the cache without a request', async (t) => {
  const calls = stubFetch(
    t,
    () => new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } }),
  );
  await resolve(t, { name: 'cached' });
  const res = await resolve(t, { name: 'cached', forceCapture: false });
  assert.equal(res.body.targets[0].fromCache, true);
  assert.equal(calls.length, 1);
});

test('a 404 or a non-video object is biu_video_missing', async (t) => {
  stubFetch(t, () => new Response(null, { status: 404 }));
  let res = await resolve(t, { name: 'gone' });
  assert.equal(res.code, 422);
  assert.equal(res.body.code, 'biu_video_missing');
  assert.deepEqual(res.body.params, { url: MP4 });
  t.mock.restoreAll();
  stubFetch(t, () => new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }));
  res = await resolve(t, { name: 'page' });
  assert.equal(res.body.code, 'biu_video_missing');
});

test('a 5xx, a 429 or a network failure is site_unreachable (503), not a missing file', async (t) => {
  for (const status of [500, 503, 429]) {
    stubFetch(t, () => new Response(null, { status }));
    const res = await resolve(t, { name: `s${status}` });
    assert.equal(res.code, 503, String(status));
    assert.equal(res.body.code, 'site_unreachable');
    assert.deepEqual(res.body.params, { host: new URL(MP4).hostname, detail: `HTTP ${status}` });
    t.mock.restoreAll();
  }
  stubFetch(t, () => {
    throw new TypeError('fetch failed');
  });
  const res = await resolve(t, { name: 'down' });
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'site_unreachable');
  t.mock.restoreAll();
  stubFetch(t, () => new Response(null, { status: 403 }));
  assert.equal((await resolve(t, { name: 'forbidden' })).body.code, 'biu_video_missing');
});

test('a ref with an unusable key is a 400 and sends nothing', async (t) => {
  const calls = stubFetch(t, () => new Response(null, { status: 200 }));
  const res = await resolve(t, { objectKey: '../etc', name: 'bad' });
  assert.equal(res.code, 400);
  assert.equal(calls.length, 0);
});
