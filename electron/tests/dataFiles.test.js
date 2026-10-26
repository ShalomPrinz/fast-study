const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const { dataFilePath, openDataFileWith, revealDataFile } = require('../dataFiles');

const DATABASE = { url: 'http://127.0.0.1:9', secret: 's3cret' };
const realFetch = globalThis.fetch;
let requests = [];

// Records every request and answers `{path}` with the given status.
function stubFetch(status = 200) {
  requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: status < 400, status, json: async () => ({ path: '/data/file.pdf' }) };
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('each target shape resolves through its own database route', async () => {
  stubFetch();
  const cases = [
    [
      { course: 'A b', lecture: 'L/1', name: 'x.pdf', kind: 'recitation' },
      '/courses/A%20b/lectures/L%2F1/files/x.pdf/path?kind=recitation',
    ],
    [
      { course: 'A', lecture: 'L', name: 'x.pdf' },
      '/courses/A/lectures/L/files/x.pdf/path?kind=lecture',
    ],
    [
      { course: 'A', assignment: 'HW 1', name: 'q.docx' },
      '/courses/A/assignments/HW%201/files/q.docx/path',
    ],
    [
      { course: 'A', assignment: 'HW 1', generated: 'plan.md' },
      '/courses/A/assignments/HW%201/generated/plan.md/path',
    ],
    [{ course: 'A', name: 'syllabus.pdf' }, '/courses/A/overview/files/syllabus.pdf/path'],
  ];
  for (const [target] of cases) {
    assert.deepEqual(await dataFilePath(target, DATABASE), { path: '/data/file.pdf' });
  }
  assert.deepEqual(
    requests.map((r) => r.url),
    cases.map(([, route]) => DATABASE.url + route),
  );
  assert.equal(requests[0].init.headers['X-FastStudy-Secret'], 's3cret');
});

test('a generated target that also names a file, or no assignment, is refused unasked', async () => {
  stubFetch();
  for (const target of [
    { course: 'A', assignment: 'HW', name: 'q.pdf', generated: 'plan.md' },
    { course: 'A', generated: 'plan.md' },
  ]) {
    assert.deepEqual(await dataFilePath(target, DATABASE), { error: 'invalid target' });
  }
  assert.equal(requests.length, 0);
});

test('a failed lookup is a failure the caller passes through', async () => {
  stubFetch(404);
  assert.deepEqual(await dataFilePath({ course: 'A', name: 'x' }, DATABASE), {
    error: 'database answered 404',
    code: 'file_not_found',
  });
  assert.deepEqual(await dataFilePath({ course: 'A', name: 'x' }, { url: '', secret: '' }), {
    error: 'the database service is not running',
  });
});

test('a non-404 failure carries no code', async () => {
  stubFetch(500);
  assert.deepEqual(await dataFilePath({ course: 'A', name: 'x' }, DATABASE), {
    error: 'database answered 500',
  });
});

test('open-with answers unsupported off Windows without asking the database', async () => {
  stubFetch();
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(
      await openDataFileWith({ course: 'A', assignment: 'HW', name: 'q.pdf' }, DATABASE, platform),
      { error: 'unsupported' },
    );
  }
  assert.equal(requests.length, 0);
});

test('reveal shows the path the database resolved', async () => {
  stubFetch();
  const shown = [];
  const target = { course: 'A', assignment: 'HW', name: 'q.pdf' };
  assert.equal(await revealDataFile(target, DATABASE, (path) => shown.push(path)), undefined);
  assert.deepEqual(shown, ['/data/file.pdf']);
  assert.equal(requests[0].url, `${DATABASE.url}/courses/A/assignments/HW/files/q.pdf/path`);
});

test('reveal passes a database failure through and shows nothing', async () => {
  stubFetch(404);
  const shown = [];
  assert.deepEqual(
    await revealDataFile({ course: 'A', name: 'x' }, DATABASE, (path) => shown.push(path)),
    { error: 'database answered 404', code: 'file_not_found' },
  );
  assert.deepEqual(shown, []);
});
