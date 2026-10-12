// The course picker (GET /courses) and the pasted-URL check (POST /courses/check), plus /list's 422
// for a course Moodle refuses. Every Moodle answer is a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { statePath } from '@faststudy/runtime';
import { setCurrentSite } from '../src/moodle/site.js';
import { readTokenFile, writeTokenFile } from '../src/auth/tokenStore.js';
import { handleCourses, handleCourseCheck, handleList } from '../src/http/server.js';
import { toCourses } from '../src/core/core.js';
import './gated.js';

const SITE = 'https://lemida.biu.ac.il';
const COURSE_URL = `${SITE}/course/view.php?id=108106`;
const TOKEN_FILE = statePath('auth', 'moodle-token.json');
const NOW = Date.UTC(2026, 9, 12);
const DAY = 86_400;

setCurrentSite(SITE);

function plantToken(t, extra = {}) {
  writeTokenFile(TOKEN_FILE, { site: SITE, wstoken: 'w'.repeat(32), userid: 185036, ...extra });
  t.after(() => fs.rmSync(TOKEN_FILE, { force: true }));
}

const json = (body) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const wsException = (errorcode, message) =>
  json({ exception: 'moodle_exception', errorcode, message });
const wall = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });

function stubFetch(t, answer) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push(new URL(String(url)));
    return answer(new URL(String(url)), init);
  });
  return calls;
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

async function call(t, handler, body = {}) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const res = fakeRes();
  await handler({ body, headers: {} }, res);
  return res;
}

test('courses map to picker rows: decoded names, course URLs, sorted by name', () => {
  const rows = toCourses(
    [
      { id: 2, fullname: 'Zeta <span>&amp; co</span>', visible: 1, enddate: 0 },
      { id: 1, displayname: 'Alpha', fullname: 'ignored', visible: 1, enddate: 0 },
    ],
    SITE,
    NOW,
  );
  assert.deepEqual(rows, [
    { id: 1, name: 'Alpha', url: `${SITE}/course/view.php?id=1`, past: false },
    { id: 2, name: 'Zeta & co', url: `${SITE}/course/view.php?id=2`, past: false },
  ]);
});

test('past: hidden, invisible, or an end date already gone by', () => {
  const now = NOW / 1000;
  const past = (c) =>
    toCourses([{ id: 1, fullname: 'C', visible: 1, enddate: 0, ...c }], SITE, NOW)[0].past;
  assert.equal(past({}), false, 'no end date is current');
  assert.equal(past({ enddate: now + DAY }), false);
  assert.equal(past({ enddate: now - DAY }), true);
  assert.equal(past({ hidden: true }), true);
  assert.equal(past({ visible: 0 }), true);
});

for (const [label, extra] of [
  ['a false flag', { coursesAvailable: false }],
  ['a record saved before the flag', {}],
]) {
  test(`GET /courses answers available:false for ${label}, with no WS call`, async (t) => {
    plantToken(t, extra);
    const calls = stubFetch(t, () => assert.fail('no Moodle call expected'));
    const res = await call(t, handleCourses);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { available: false });
    assert.equal(calls.length, 0);
  });
}

test('GET /courses on a verified token is exactly one core_enrol_get_users_courses call', async (t) => {
  plantToken(t, { coursesAvailable: true });
  const calls = stubFetch(t, () =>
    json([{ id: 108106, fullname: 'Algorithms', visible: 1, enddate: 0 }]),
  );
  const res = await call(t, handleCourses);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, {
    available: true,
    courses: [{ id: 108106, name: 'Algorithms', url: COURSE_URL, past: false }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('wsfunction'), 'core_enrol_get_users_courses');
  assert.equal(calls[0].searchParams.get('userid'), '185036');
});

test('GET /courses verifies an unverified token first, then lists, in one request', async (t) => {
  plantToken(t, { unverified: true, userid: null });
  const functions = [
    'core_course_get_contents',
    'tool_mobile_get_content',
    'core_enrol_get_users_courses',
  ].map((name) => ({ name }));
  const calls = stubFetch(t, (url) =>
    url.searchParams.get('wsfunction') === 'core_webservice_get_site_info'
      ? json({ userid: 7, downloadfiles: 1, functions })
      : json([]),
  );
  const res = await call(t, handleCourses);
  assert.deepEqual(res.body, { available: true, courses: [] });
  assert.deepEqual(
    calls.map((u) => u.searchParams.get('wsfunction')),
    ['core_webservice_get_site_info', 'core_enrol_get_users_courses'],
  );
  assert.equal(calls[1].searchParams.get('userid'), '7');
  assert.equal(readTokenFile(TOKEN_FILE).coursesAvailable, true);
});

test('GET /courses: a dead token is 401 reconnect, a wall 503 blocked', async (t) => {
  plantToken(t, { coursesAvailable: true });
  stubFetch(t, () => wsException('invalidtoken', 'Invalid token'));
  let res = await call(t, handleCourses);
  assert.equal(res.code, 401);
  assert.equal(res.body.code, 'moodle_reconnect_required');

  t.mock.restoreAll();
  plantToken(t, { coursesAvailable: true });
  stubFetch(t, wall);
  res = await call(t, handleCourses);
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'site_blocked');
});

for (const [label, url, code] of [
  ['scheme-less', 'lemida.biu.ac.il/course/view.php?id=1', 'course_url_not_course_page'],
  ['off-site', 'https://moodle.other.ac.il/course/view.php?id=1', 'course_url_unsupported_site'],
  ['an activity link', `${SITE}/mod/resource/view.php?id=1`, 'course_url_not_course_page'],
  ['a section link', `${SITE}/course/section.php?id=1`, 'course_url_not_course_page'],
  ['a course by name', `${SITE}/course/view.php?name=algo`, 'course_url_not_course_page'],
  ['a non-digit id', `${SITE}/course/view.php?id=12a`, 'course_url_not_course_page'],
]) {
  test(`POST /courses/check refuses ${label} as 400 ${code}, with no WS call`, async (t) => {
    plantToken(t);
    const calls = stubFetch(t, () => assert.fail('no Moodle call expected'));
    const res = await call(t, handleCourseCheck, { courseUrl: url });
    assert.equal(res.code, 400);
    assert.equal(res.body.code, code);
    assert.equal(res.body.params.url, url);
    assert.equal(calls.length, 0);
  });
}

test('POST /courses/check: a readable course is 200 ok after one contents call', async (t) => {
  plantToken(t);
  const calls = stubFetch(t, () => json([]));
  const res = await call(t, handleCourseCheck, { courseUrl: COURSE_URL });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('wsfunction'), 'core_course_get_contents');
  assert.equal(calls[0].searchParams.get('courseid'), '108106');
});

for (const [label, handler] of [
  ['POST /courses/check', handleCourseCheck],
  ['POST /list', handleList],
]) {
  test(`${label}: a Moodle refusal is 422 course_not_accessible with its message verbatim`, async (t) => {
    plantToken(t);
    stubFetch(t, () => wsException('requireloginerror', 'Course or activity not accessible.'));
    const res = await call(t, handler, { courseUrl: COURSE_URL });
    assert.equal(res.code, 422);
    assert.equal(res.body.code, 'course_not_accessible');
    assert.deepEqual(res.body.params, {
      url: COURSE_URL,
      detail: 'Course or activity not accessible.',
    });
  });
}

test('POST /courses/check: a dead token is 401 reconnect, a wall 503 blocked', async (t) => {
  plantToken(t);
  stubFetch(t, () => wsException('invalidtoken', 'Invalid token'));
  let res = await call(t, handleCourseCheck, { courseUrl: COURSE_URL });
  assert.equal(res.code, 401);
  assert.equal(res.body.code, 'moodle_reconnect_required');

  t.mock.restoreAll();
  plantToken(t);
  stubFetch(t, wall);
  res = await call(t, handleCourseCheck, { courseUrl: COURSE_URL });
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'site_blocked');
});
