// Every failure this service reports carries a machine `code` and flat `params` beside its English
// prose (repo-root `docs/ERROR-CODES.md`). These assert the code and the params, never the prose —
// the frontend owns the sentence and the prose is only its unknown-code fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidRequest, validateKind } from '../src/validate.js';
import { createJob, finishJob, listJobs } from '../src/jobs.js';
import { cancelRun, createRun, resumeRun } from '../src/runs.js';
import { downloadItem, reresolveFailure } from '../src/routes/downloadItem.js';
import { resolve } from '../src/services/autodl.js';
import { uploadPdf } from '../src/services/database.js';

function stubFetch(t, impl) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = impl;
}

const jobOf = (id) => listJobs().find((job) => job.id === id);

// ── request validation ──────────────────────────────────────────────────────

test('a malformed request names the offending field', () => {
  assert.deepEqual(invalidRequest('url', 'valid url required'), {
    error: 'valid url required',
    code: 'invalid_request',
    params: { field: 'url' },
  });
  assert.deepEqual(validateKind('material'), {
    error: 'invalid kind: material',
    code: 'invalid_request',
    params: { field: 'kind' },
  });
  assert.equal(validateKind('recitation'), null);
});

// ── the job channel ─────────────────────────────────────────────────────────

test('a failed job carries its code and params to /jobs', () => {
  const id = createJob({ course: 'C', lecture: 'L1', kind: 'lecture', tool: 'curl' });
  finishJob(id, 'error', 'exited with code 22\n403 Forbidden', 'download_tool_failed', {
    tool: 'curl',
    exit_code: 22,
    detail: '403 Forbidden',
  });
  const job = jobOf(id);
  assert.equal(job.code, 'download_tool_failed');
  assert.deepEqual(job.params, { tool: 'curl', exit_code: 22, detail: '403 Forbidden' });
});

test('a job that succeeded carries neither', () => {
  const id = createJob({ course: 'C', lecture: 'L2', kind: 'lecture', tool: 'curl' });
  finishJob(id, 'done');
  assert.deepEqual({ code: jobOf(id).code, params: jobOf(id).params }, { code: null, params: null });
});

// ── the section-run registry ────────────────────────────────────────────────

test('an unknown or unparked run answers its own code', () => {
  assert.deepEqual(cancelRun('nope'), {
    error: 'unknown run',
    code: 'run_unknown',
    params: {},
  });
  assert.deepEqual(resumeRun('nope'), { error: 'unknown run', code: 'run_unknown', params: {} });

  const run = createRun({
    sectionId: 'c:video:codes',
    course: 'c',
    targets: [{ ref: 'r', name: 'a', kind: 'lecture' }],
  });
  assert.deepEqual(resumeRun(run.id), {
    error: 'run is not paused',
    code: 'run_not_paused',
    params: {},
  });
});

// ── the resolver edge to auto/ ──────────────────────────────────────────────

test("a re-resolve maps auto's statuses to its own codes", () => {
  assert.deepEqual(reresolveFailure(401, null), {
    error: 'reconnect Moodle',
    code: 'recapture_reconnect_required',
    params: {},
  });
  assert.deepEqual(reresolveFailure(409, { reason: 'missing' }), {
    error: 'passcode needed',
    code: 'recapture_passcode_required',
    params: {},
  });
  assert.deepEqual(reresolveFailure(422, { message: 'a web page, not a file' }), {
    error: 'source unsupported: a web page, not a file',
    code: 'recapture_unsupported',
    params: { detail: 'a web page, not a file' },
  });
  assert.deepEqual(reresolveFailure(500, { error: 'boom' }), {
    error: 're-capture failed: boom',
    code: 'recapture_failed',
    params: { detail: 'boom' },
  });
  // status 0 is "never reached auto at all", and reads as the network failure it is.
  assert.deepEqual(reresolveFailure(0, null).params, { detail: 'HTTP network' });
});

test('an unreachable auto/ is one code whichever half produced the body', async (t) => {
  stubFetch(t, async () => {
    throw new Error('fetch failed');
  });
  const { status, body } = await resolve({ ref: 'r', course: 'C', name: 'L', kind: 'lecture' });
  assert.equal(status, 0);
  assert.deepEqual(body, {
    error: 'fetch failed',
    code: 'autodl_unreachable',
    params: { detail: 'fetch failed' },
  });

  // The other shape: auto answered a non-2xx with nothing parseable.
  globalThis.fetch = async () => ({
    status: 502,
    json: async () => {
      throw new Error('not json');
    },
  });
  const refused = await downloadItem({ ref: 'r', course: 'C', name: 'L', kind: 'lecture' });
  assert.deepEqual(refused, {
    status: 502,
    body: {
      error: 'auto-downloader unreachable',
      code: 'autodl_unreachable',
      params: { detail: 'HTTP 502' },
    },
  });
});

test('a 2xx with nothing runnable is its own code', async (t) => {
  stubFetch(t, async () => ({ status: 200, json: async () => ({ media: 'video', targets: [] }) }));
  const { status, body } = await downloadItem({
    ref: 'r',
    course: 'C',
    name: 'L',
    kind: 'lecture',
  });
  assert.equal(status, 502);
  assert.deepEqual(body, {
    error: 'auto returned no usable target',
    code: 'autodl_no_target',
    params: {},
  });
});

// ── the database edge ───────────────────────────────────────────────────────

test("a refused store carries the database's own text as detail", async (t) => {
  stubFetch(t, async () => ({
    ok: false,
    status: 423,
    json: async () => ({ error: 'file is open elsewhere', code: 'file_locked' }),
  }));
  assert.deepEqual(await uploadPdf(Buffer.from('%PDF'), 'C', 'L1', 'lecture'), {
    error: 'file is open elsewhere',
    code: 'database_store_failed',
    params: { detail: 'file is open elsewhere' },
  });
});

test('a database with no body at all still says what happened', async (t) => {
  stubFetch(t, async () => ({
    ok: false,
    status: 500,
    json: async () => {
      throw new Error('not json');
    },
  }));
  assert.deepEqual((await uploadPdf(Buffer.from('%PDF'), 'C', 'L1', 'lecture')).params, {
    detail: 'HTTP 500',
  });
});
