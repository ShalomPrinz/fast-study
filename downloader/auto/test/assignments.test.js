// Assignment files: /list's mod_assign_get_assignments call, its quiet skip, and /resolve's target.
// Every Moodle answer is a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { statePath } from '@faststudy/runtime';
import { setCurrentSite } from '../src/moodle/site.js';
import { writeTokenFile } from '../src/auth/tokenStore.js';
import { handleList, handleResolve } from '../src/http/server.js';
import { encodeRef } from '../src/lib/ref.js';
import { listRecordings } from '../src/core/core.js';
import './gated.js';

const SITE = 'https://lemida.biu.ac.il';
const COURSE_URL = `${SITE}/course/view.php?id=108106`;
const TOKEN_FILE = statePath('auth', 'moodle-token.json');
const pf = (name) => `${SITE}/webservice/pluginfile.php/9/mod_assign/intro/${name}`;

setCurrentSite(SITE);

const CONTENTS = [
  { name: 'Week 1', modules: [{ id: 501, modname: 'assign', name: 'HW1' }] },
  { name: '<span>Week 2</span>', modules: [{ id: 502, modname: 'assign', name: 'HW2' }] },
];
const file = (filename, mimetype = 'application/pdf') => ({
  filename,
  mimetype,
  fileurl: pf(filename),
});
const ASSIGNMENTS = {
  courses: [
    {
      id: 108106,
      assignments: [
        { cmid: 501, name: 'HW1', introattachments: [file('hw1.pdf')], introfiles: [] },
        {
          cmid: 502,
          name: 'HW2',
          introattachments: [file('starter.py', 'text/x-python'), file('data.mp3', 'audio/mpeg')],
          introfiles: [file('starter.py', 'text/x-python')],
        },
        { cmid: 999, name: 'Hidden', introattachments: [file('h.pdf')], introfiles: [] },
      ],
    },
  ],
  warnings: [],
};

const json = (body) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const wsException = (errorcode, message) =>
  json({ exception: 'webservice_access_exception', errorcode, message });

function plantToken(t) {
  writeTokenFile(TOKEN_FILE, { site: SITE, wstoken: 'w'.repeat(32), userid: 1 });
  t.after(() => fs.rmSync(TOKEN_FILE, { force: true }));
}

function stubFetch(t, assignAnswer) {
  const fns = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(String(url));
    const fn = u.searchParams.get('wsfunction');
    if (!fn)
      return new Response('x', { status: 206, headers: { 'content-type': 'application/pdf' } });
    fns.push(fn);
    return fn === 'core_course_get_contents' ? json(CONTENTS) : assignAnswer();
  });
  return fns;
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

async function call(t, handler, body) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const res = fakeRes();
  await handler({ body, query: {}, headers: {} }, res);
  return res;
}

test('/list adds one assignment Item per file, deduped, joined to its section', async (t) => {
  plantToken(t);
  const fns = stubFetch(t, () => json(ASSIGNMENTS));
  const res = await call(t, handleList, { courseUrl: COURSE_URL });
  assert.equal(res.code, 200);
  assert.deepEqual(fns, ['core_course_get_contents', 'mod_assign_get_assignments']);
  const items = res.body.items.filter((i) => i.media === 'assignment');
  assert.deepEqual(
    items.map((i) => [i.title, i.filename, i.section]),
    [
      ['HW1 — hw1.pdf', 'hw1.pdf', 'Week 1'],
      ['HW2 — starter.py', 'starter.py', 'Week 2'],
      ['HW2 — data.mp3', 'data.mp3', 'Week 2'],
      ['Hidden — h.pdf', 'h.pdf', ''],
    ],
  );
  assert.equal(items[0].origin, 'assign');
  assert.equal(items[0].assignment, 'HW1');
  assert.equal(items[0].moodle, true);
});

test('/list: a token service without the function lists on, quietly', async (t) => {
  plantToken(t);
  stubFetch(t, () => wsException('accessexception', 'Access control exception'));
  const res = await call(t, handleList, { courseUrl: COURSE_URL });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.items, []);
});

for (const [label, answer, code] of [
  ['a dead token', () => wsException('invalidtoken', 'Invalid token'), 401],
  [
    'a bot wall',
    () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    503,
  ],
  ['another Moodle refusal', () => wsException('requireloginerror', 'Not accessible'), 422],
]) {
  test(`/list: ${label} on the assignments call surfaces as the contents call's would`, async (t) => {
    plantToken(t);
    stubFetch(t, answer);
    const res = await call(t, handleList, { courseUrl: COURSE_URL });
    assert.equal(res.code, code);
  });
}

test('an assignment file resolves as media assignment with its filename', async (t) => {
  plantToken(t);
  stubFetch(t, () => json(ASSIGNMENTS));
  const [row] = listRecordings(CONTENTS, '108106', ASSIGNMENTS);
  const res = await call(t, handleResolve, {
    ref: encodeRef(row),
    course: 'C',
    name: 'HW1',
    kind: 'lecture',
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.media, 'assignment');
  const [target] = res.body.targets;
  assert.equal(target.tool, 'fetch');
  assert.equal(target.name, 'HW1');
  assert.equal(target.filename, 'hw1.pdf');
  assert.match(target.url, /^\/moodle\/file\//);
});

test('two files of one assignment resolve to two proxies, not one cached cap', async (t) => {
  plantToken(t);
  stubFetch(t, () => json(ASSIGNMENTS));
  const rows = listRecordings(CONTENTS, '108106', ASSIGNMENTS).filter(
    (r) => r.assignment === 'HW2',
  );
  const urls = [];
  for (const row of rows) {
    const res = await call(t, handleResolve, {
      ref: encodeRef(row),
      course: 'C',
      name: 'HW2',
      kind: 'lecture',
    });
    urls.push(res.body.targets[0].url);
  }
  assert.equal(new Set(urls).size, 2);
});
