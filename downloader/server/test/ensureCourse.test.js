// The routes create the extension's course first; a loopback stand-in database answers 409
// `name_taken` for an existing one, which must read as success, and `/tree` is never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

const courses = new Set();
const seen = [];
// Overridable per test: what POST /courses answers, given the name.
let createAnswer = null;
const db = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({ method: req.method, path: req.url, body: raw });
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/courses') {
      const { name } = JSON.parse(raw);
      if (createAnswer) return createAnswer(res, json);
      if (courses.has(name)) {
        return json(409, {
          error: `'${name}' already exists`,
          code: 'name_taken',
          params: { name },
        });
      }
      courses.add(name);
      return res.writeHead(204).end();
    }
    if (req.method === 'POST' && req.url.includes('/materials')) {
      const course = decodeURIComponent(req.url.split('/')[2]);
      if (!courses.has(course)) {
        return json(404, { error: 'no course', code: 'course_not_found', params: { course } });
      }
      return json(200, { name: 'material.pdf' });
    }
    if (req.url === '/notify') return res.writeHead(204).end();
    json(404, { error: 'unexpected', code: 'x', params: {} });
  });
});
await new Promise((r) => db.listen(0, '127.0.0.1', r));
test.after(() => {
  db.closeAllConnections();
  db.close();
});

process.env.DATABASE_URL = `http://127.0.0.1:${db.address().port}`;
const { ensureCourse } = await import('../src/services/database.js');
const { default: pdfRouter } = await import('../src/routes/pdf.js');

test.beforeEach(() => {
  courses.clear();
  seen.length = 0;
  createAnswer = null;
});

const posts = () => seen.filter((s) => s.method === 'POST' && s.path === '/courses');

test.afterEach(() => {
  assert.equal(seen.filter((s) => s.path === '/tree').length, 0);
});

test('an existing course answers 409 name_taken, which counts as success', async () => {
  courses.add('Calculus');
  assert.equal(await ensureCourse('Calculus'), null);
  assert.equal(posts().length, 1);
  assert.ok(courses.has('Calculus'));
});

test('a missing course is created with the stored name', async () => {
  assert.equal(await ensureCourse('אינפי 1'), null);
  assert.ok(courses.has('אינפי 1'));
  assert.deepEqual(JSON.parse(posts()[0].body), { name: 'אינפי 1', source_url: null });
});

test("a create that loses to another's answers name_taken, which counts as success", async () => {
  createAnswer = (res, json) =>
    json(409, { error: "'C' already exists", code: 'name_taken', params: { name: 'C' } });
  assert.equal(await ensureCourse('C'), null);
});

test('two concurrent ensures of one new course both succeed, and one create wins', async () => {
  const results = await Promise.all([ensureCourse('Race'), ensureCourse('Race')]);
  assert.deepEqual(results, [null, null]);
  assert.ok(courses.has('Race'));
});

test("any other refusal is forwarded with the database's own code", async () => {
  createAnswer = (res, json) =>
    json(409, { error: 'DATA_ROOT unset', code: 'data_root_not_configured', params: {} });
  assert.deepEqual(await ensureCourse('C'), {
    error: 'DATA_ROOT unset',
    code: 'data_root_not_configured',
    params: {},
  });
});

test('/upload-pdf into a brand-new course creates it, then stores the PDF', async () => {
  const app = express().use(pdfRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/upload-pdf?course=New&lecture=L1`,
      { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.4' },
    );
    assert.equal(res.status, 200);
    assert.ok(courses.has('New'));
    assert.deepEqual(
      seen.map((s) => `${s.method} ${s.path.split('?')[0]}`).filter((s) => !s.endsWith('/notify')),
      ['POST /courses', 'POST /courses/New/lectures/L1/materials'],
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('/upload-pdf answers 502 with the refusal and stores nothing when the create is refused', async () => {
  createAnswer = (res, json) =>
    json(500, { error: 'disk full', code: 'disk_full', params: { detail: 'x' } });
  const app = express().use(pdfRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/upload-pdf?course=New&lecture=L1`,
      { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.4' },
    );
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), {
      error: 'disk full',
      code: 'disk_full',
      params: { detail: 'x' },
    });
    assert.equal(seen.filter((s) => s.path.includes('/materials')).length, 0);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
