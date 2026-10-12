// A videostream row resolves through mod_videostream's Moodle-app handler: one tool_mobile_get_content
// POST, sent exactly as the app sends it, whose rendered `<video>` names a public .mp4. The fixture
// is a real reply, trimmed to its `<video>` block.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { statePath } from '@faststudy/runtime';
import { setCurrentSite } from '../src/moodle/site.js';
import { writeTokenFile } from '../src/auth/tokenStore.js';
import { handleResolve } from '../src/http/server.js';
import { listRecordings } from '../src/core/core.js';
import { encodeRef } from '../src/lib/ref.js';
import { siteAuth } from '../src/core/registry.js';
import './gated.js';

const SITE = 'https://lemida.biu.ac.il';
const PAGE_URL = `${SITE}/mod/videostream/view.php?id=3047355`;
const MP4 =
  'https://axt1t2yu790u.compat.objectstorage.il-jerusalem-1.oraclecloud.com/video_bucket/3d/3dac113ed4a4b0299883cc4dca27d65008f266f4.mp4';
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'videostream-content.json'), 'utf8'),
);
const TOKEN_FILE = statePath('auth', 'moodle-token.json');

setCurrentSite(SITE);

function plantToken(t) {
  writeTokenFile(TOKEN_FILE, { site: SITE, wstoken: 'w'.repeat(32), userid: 185036 });
  t.after(() => fs.rmSync(TOKEN_FILE, { force: true }));
}

const json = (body) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

// Records every fetch; `answer(url, init)` decides what each one gets.
function stubFetch(t, answer) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: new URL(String(url)), init });
    return answer(new URL(String(url)), init);
  });
  return calls;
}

// The handler's reply with its first `<source>` swapped for `source`.
function withSource(source) {
  const html = FIXTURE.templates[0].html.replace(/<source\b[^>]*>/, source);
  return { ...FIXTURE, templates: [{ id: 'main', html }] };
}

function fakeRes() {
  const res = {
    code: null,
    body: null,
    status(code) {
      res.code = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    on() {},
  };
  return res;
}

// One /resolve of the module, as a row listed with `courseId` (or, with none, by an older build).
async function resolve(t, { courseId = '108106', name = 'L', forceCapture = false } = {}) {
  t.mock.method(console, 'log', () => {});
  const ref = encodeRef({
    strategy: 'videostream',
    pageUrl: PAGE_URL,
    kind: 'recitation',
    ...(courseId ? { courseId } : {}),
  });
  const res = fakeRes();
  await handleResolve({ body: { ref, course: 'C', name, kind: 'recitation', forceCapture } }, res);
  return res;
}

test('the content call is a POST carrying every app arg, userid included, and never id', async (t) => {
  plantToken(t);
  const calls = stubFetch(t, () => json(FIXTURE));
  const res = await resolve(t, { name: 'args', forceCapture: true });
  assert.equal(res.code, 200);
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['User-Agent'], 'MoodleMobile 4.4.0 (44000)');
  assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(url.searchParams.get('wsfunction'), 'tool_mobile_get_content');
  assert.equal(url.searchParams.get('moodlewsrestformat'), 'json');
  assert.equal(url.searchParams.get('wstoken'), 'w'.repeat(32));
  assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body.toString())), {
    moodlewssettingfilter: 'true',
    moodlewssettingfileurl: 'true',
    moodlewssettinglang: 'he',
    component: 'mod_videostream',
    method: 'view_videostream',
    'args[0][name]': 'courseid',
    'args[0][value]': '108106',
    'args[1][name]': 'cmid',
    'args[1][value]': '3047355',
    'args[2][name]': 'userid',
    'args[2][value]': '185036',
    'args[3][name]': 'appid',
    'args[3][value]': 'com.moodle.moodlemobile',
    'args[4][name]': 'appversioncode',
    'args[4][value]': '45000',
    'args[5][name]': 'appversionname',
    'args[5][value]': '4.5.0',
    'args[6][name]': 'applang',
    'args[6][value]': 'he',
    'args[7][name]': 'appcustomurlscheme',
    'args[7][value]': 'moodlemobile',
    'args[8][name]': 'appisdesktop',
    'args[8][value]': '0',
    'args[9][name]': 'appismobile',
    'args[9][value]': '1',
    'args[10][name]': 'appiswide',
    'args[10][value]': '0',
    'args[11][name]': 'appplatform',
    'args[11][value]': 'android',
  });
});

test("the fixture's .mp4 is one plain curl target, not proxied through auto", async (t) => {
  plantToken(t);
  stubFetch(t, () => json(FIXTURE));
  const res = await resolve(t, { name: 'mp4', forceCapture: true });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, {
    media: 'video',
    targets: [{ name: 'mp4', tool: 'curl', url: MP4, headers: [], fromCache: false }],
  });
});

test('an &amp; in the source is decoded', async (t) => {
  plantToken(t);
  const url = 'https://cdn.test/v/a.mp4?x=1&y=2';
  stubFetch(t, () =>
    json(withSource('<source src="https://cdn.test/v/a.mp4?x=1&amp;y=2" type="video/mp4" />')),
  );
  const res = await resolve(t, { name: 'amp', forceCapture: true });
  assert.equal(res.body.targets[0].url, url);
});

test('an HLS-only player is videostream_no_mp4, naming the module page', async (t) => {
  plantToken(t);
  stubFetch(t, () =>
    json(withSource('<source src="https://cdn.test/v/a.m3u8" type="application/x-mpegURL" />')),
  );
  const err = await resolve(t, { name: 'hls', forceCapture: true }).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.code, 'videostream_no_mp4');
  assert.deepEqual(err.params, { url: PAGE_URL });
  assert.match(err.message, /application\/x-mpegURL/);
});

test('an invalidtoken answer marks the token expired and is 401 reconnect', async (t) => {
  plantToken(t);
  t.mock.method(console, 'warn', () => {});
  stubFetch(t, () => json({ exception: 'x', errorcode: 'invalidtoken', message: 'bad' }));
  const res = await resolve(t, { name: 'dead', forceCapture: true });
  assert.equal(res.code, 401);
  assert.deepEqual(res.body, {
    status: 'reconnect',
    code: 'moodle_reconnect_required',
    params: {},
  });
  assert.equal(siteAuth().auth.status().expired, true);
});

test('a wall with no browser to carry the call is 503 site_blocked', async (t) => {
  plantToken(t);
  stubFetch(t, () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
  const res = await resolve(t, { name: 'wall', forceCapture: true });
  assert.equal(res.code, 503);
  assert.equal(res.body.status, 'blocked');
  assert.equal(res.body.code, 'site_blocked');
  assert.equal(res.body.params.challengeWindow, false);
});

test('a row listed with no courseId first asks core_course_get_course_module for it', async (t) => {
  plantToken(t);
  const calls = stubFetch(t, (url) =>
    url.searchParams.get('wsfunction') === 'core_course_get_course_module'
      ? json({ cm: { id: 3047355, course: 108106 }, warnings: [] })
      : json(FIXTURE),
  );
  const res = await resolve(t, { name: 'legacy', courseId: null, forceCapture: true });
  assert.equal(res.code, 200);
  assert.deepEqual(
    calls.map((c) => c.url.searchParams.get('wsfunction')),
    ['core_course_get_course_module', 'tool_mobile_get_content'],
  );
  assert.equal(calls[0].url.searchParams.get('cmid'), '3047355');
  assert.equal(new URLSearchParams(calls[1].init.body.toString()).get('args[0][value]'), '108106');
});

test('a replay-cache hit answers from the cache with no WS call', async (t) => {
  plantToken(t);
  const calls = stubFetch(t, () => json(FIXTURE));
  assert.equal((await resolve(t, { name: 'replay' })).code, 200);
  const res = await resolve(t, { name: 'replay' });
  assert.equal(calls.length, 1);
  assert.equal(res.body.targets[0].url, MP4);
  assert.equal(res.body.targets[0].fromCache, true);
});

test('a listed videostream row carries its course id', () => {
  const [row] = listRecordings(
    [
      {
        name: 'Recitations',
        modules: [{ modname: 'videostream', name: 'Recitation 1', url: PAGE_URL }],
      },
    ],
    '108106',
  );
  assert.equal(row.strategy, 'videostream');
  assert.equal(row.courseId, '108106');
});
