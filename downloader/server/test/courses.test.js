// The popup's course reads: /courses keeps each course's resolved lectures_only, and
// /course-structure relays the database's live global mode, both against a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.DATABASE_URL = 'http://db.invalid';
const { default: coursesRouter } = await import('../src/routes/courses.js');

const realFetch = globalThis.fetch;
let answers = {};
const seen = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('http://db.invalid')) return realFetch(url, init);
  const path = u.slice('http://db.invalid'.length);
  seen.push(path);
  const [status, body] = answers[path] ?? [404, { error: 'unexpected' }];
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const app = express().use(coursesRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => {
  globalThis.fetch = realFetch;
  server.closeAllConnections();
  server.close();
});
test.beforeEach(() => {
  answers = {};
  seen.length = 0;
});

test('/courses keeps lectures_only per course, names only, archived dropped', async () => {
  answers['/tree'] = [
    200,
    [
      {
        name: 'Calc',
        lectures_only: true,
        archived: false,
        lectures: [{ name: 'L1', status: 'done' }],
        recitations: [],
      },
      { name: 'Algebra', lectures_only: false, lectures: [], recitations: [{ name: 'R1' }] },
      { name: 'Old', lectures_only: true, archived: true, lectures: [], recitations: [] },
    ],
  ];
  const res = await realFetch(`${base}/courses`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [
    { name: 'Calc', lectures_only: true, lectures: ['L1'], recitations: [] },
    { name: 'Algebra', lectures_only: false, lectures: [], recitations: ['R1'] },
  ]);
});

test('/course-structure relays the live global mode', async () => {
  answers['/course_structure'] = [200, { course_structure: 'lectures_all' }];
  const res = await realFetch(`${base}/course-structure`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { course_structure: 'lectures_all' });
  assert.deepEqual(seen, ['/course_structure']);
});

test('/course-structure answers 500 when the database refuses', async () => {
  answers['/course_structure'] = [503, { error: 'down' }];
  const res = await realFetch(`${base}/course-structure`);
  assert.equal(res.status, 500);
});
