const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const { dataFilePath, openDataFileWith } = require('../dataFiles');

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
    [{ course: 'A', name: 'syllabus.pdf' }, '/courses/A/overview/files/syllabus.pdf/path'],
  ];
  for (const [target] of cases) {
    assert.deepEqual(await dataFilePath(target, DATABASE), { ok: true, path: '/data/file.pdf' });
  }
  assert.deepEqual(
    requests.map((r) => r.url),
    cases.map(([, route]) => DATABASE.url + route),
  );
  assert.equal(requests[0].init.headers['X-FastStudy-Secret'], 's3cret');
});

test('a failed lookup is a failure the caller passes through', async () => {
  stubFetch(404);
  assert.deepEqual(await dataFilePath({ course: 'A', name: 'x' }, DATABASE), {
    ok: false,
    error: 'database answered 404',
  });
  assert.deepEqual(await dataFilePath({ course: 'A', name: 'x' }, { url: '', secret: '' }), {
    ok: false,
    error: 'the database service is not running',
  });
});

test('open-with answers unsupported off Windows without asking the database', async () => {
  stubFetch();
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(
      await openDataFileWith({ course: 'A', assignment: 'HW', name: 'q.pdf' }, DATABASE, platform),
      { ok: false, error: 'unsupported' },
    );
  }
  assert.equal(requests.length, 0);
});
