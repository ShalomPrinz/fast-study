// Every failure this service reports carries a machine `code` and flat `params` beside its English
// prose (repo-root `docs/ERROR-CODES.md`). These assert the code and the params, never the prose —
// the frontend owns the sentence and the prose is only its unknown-code fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidRequest, validateKind } from '../src/validate.js';
import { createJob, finishJob, listJobs } from '../src/jobs.js';
import { cancelRun, createRun, resumeRun } from '../src/runs.js';
import { reresolveFailure } from '../src/routes/downloadItem.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MATERIAL_TEMP_FILENAME } from '../src/config.js';
import { uploadMaterial, uploadPdf } from '../src/services/database.js';

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
  assert.deepEqual(
    { code: jobOf(id).code, params: jobOf(id).params },
    { code: null, params: null },
  );
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

// ── the database edge ───────────────────────────────────────────────────────

test("a refused store forwards the database's own code and params", async (t) => {
  stubFetch(t, async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      error: "'overview' is reserved",
      code: 'name_reserved',
      params: { name: 'overview' },
    }),
  }));
  assert.deepEqual(await uploadPdf(Buffer.from('%PDF'), 'C', 'overview', 'lecture'), {
    error: "'overview' is reserved",
    code: 'name_reserved',
    params: { name: 'overview' },
  });
});

test('a forwarded code with no params still carries an object', async (t) => {
  stubFetch(t, async () => ({
    ok: false,
    status: 423,
    json: async () => ({ error: 'file is open elsewhere', code: 'file_locked' }),
  }));
  assert.deepEqual(await uploadPdf(Buffer.from('%PDF'), 'C', 'L1', 'lecture'), {
    error: 'file is open elsewhere',
    code: 'file_locked',
    params: {},
  });
});

test('a refused job upload reaches /jobs with the database code unchanged', async (t) => {
  stubFetch(t, async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'reserved', code: 'name_reserved', params: { name: 'overview' } }),
  }));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-material-'));
  fs.writeFileSync(path.join(tempDir, MATERIAL_TEMP_FILENAME), '%PDF');
  const failure = await uploadMaterial(tempDir, 'C', 'overview', 'lecture', 'fetch');
  assert.equal(fs.existsSync(tempDir), false);
  const id = createJob({ course: 'C', lecture: 'overview', kind: 'lecture', tool: 'fetch' });
  finishJob(id, 'error', failure.error, failure.code, failure.params);
  assert.deepEqual(
    { code: jobOf(id).code, params: jobOf(id).params },
    { code: 'name_reserved', params: { name: 'overview' } },
  );
});

test('a refusal with no code wraps its text as detail', async (t) => {
  stubFetch(t, async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'boom' }),
  }));
  assert.deepEqual(await uploadPdf(Buffer.from('%PDF'), 'C', 'L1', 'lecture'), {
    error: 'boom',
    code: 'database_store_failed',
    params: { detail: 'boom' },
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
