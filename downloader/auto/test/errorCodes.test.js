// Every failure this service reports carries a machine `code` and flat `params` beside its English
// prose (repo-root `docs/ERROR-CODES.md`). These assert the code and the params, never the prose —
// the frontend owns the sentence and the prose is only its unknown-code fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// An empty state root, so the auth pill this file drives reads the token file planted below and
// never the developer's own. Set before the first import that resolves a state path.
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-codes-'));
process.env.FASTSTUDY_STATE_DIR = STATE_DIR;
const TOKEN_FILE = path.join(STATE_DIR, 'auth', 'biu-token.json');
process.on('exit', () => fs.rmSync(STATE_DIR, { recursive: true, force: true }));
import { CodedError, PasscodeError, UnsupportedError, failureOf } from '../src/lib/errors.js';
import { resolveUniversity } from '../src/core/registry.js';
import { courseIdFrom, getCourseContents, pluginfileUrl } from '../src/moodle/wsClient.js';
import { resolveDirectUrl } from '../src/core/core.js';
import { probeDriveFile } from '../src/extractors/GoogleDriveExtractor.js';
import { YoutubePlaylistExtractor } from '../src/extractors/YoutubePlaylistExtractor.js';
import {
  handleList,
  handleListExpand,
  handleResolve,
  handleZoomPasscode,
  sendPasscode,
  sendUnsupported,
} from '../src/http/server.js';
import { encodeRef } from '../src/lib/ref.js';

// What was thrown, never what was returned — every site here fails by throwing.
const thrown = async (fn) =>
  fn().then(
    () => null,
    (e) => e,
  );
const codeOf = (err) => ({ code: err.code, params: err.params });

function stubFetch(t, impl) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = impl;
}

// Enough of an Express response for the handlers' send(): records the status and the body.
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
  };
  return res;
}

const directUrlRecording = (pageUrl) => ({ pageUrl, strategy: 'direct-url', kind: 'lecture' });

// ── the carrier ─────────────────────────────────────────────────────────────

test('a coded error answers with its own code, anything else with internal_error', () => {
  assert.deepEqual(failureOf(new CodedError('playlist_empty', { url: 'u' }, 'nothing there')), {
    error: 'nothing there',
    code: 'playlist_empty',
    params: { url: 'u' },
  });
  assert.deepEqual(failureOf(new Error('kaboom')), {
    error: 'kaboom',
    code: 'internal_error',
    params: { detail: 'kaboom' },
  });
});

// A Node system error spells its own `code` ('ENOENT'), which is not one of ours and must not
// reach the wire as though it were.
test("a system error's own code is never mistaken for a protocol code", () => {
  const err = Object.assign(new Error('open failed'), { code: 'ENOENT' });
  assert.equal(failureOf(err).code, 'internal_error');
});

test('the two typed throws carry the code their refusal answers with', () => {
  assert.deepEqual(codeOf(new PasscodeError('missing')), {
    code: 'zoom_passcode_required',
    params: { reason: 'missing', course: null, name: null },
  });
  assert.deepEqual(codeOf(new UnsupportedError('link_dead', { url: 'u' }, 'gone')), {
    code: 'link_dead',
    params: { url: 'u' },
  });
});

// ── course URLs and the Moodle WS ───────────────────────────────────────────

test('a course URL from an unhandled site, and one with no id', () => {
  assert.deepEqual(codeOf(thrownSync(() => resolveUniversity('https://moodle.other.ac.il/x'))), {
    code: 'course_url_unsupported_site',
    params: { url: 'https://moodle.other.ac.il/x' },
  });
  assert.deepEqual(
    codeOf(thrownSync(() => courseIdFrom('https://lemida.biu.ac.il/course/view.php'))),
    {
      code: 'course_url_no_id',
      params: { url: 'https://lemida.biu.ac.il/course/view.php' },
    },
  );
});

function thrownSync(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

test("a WS fault carries Moodle's errorcode, a challenge the shape it served", async (t) => {
  stubFetch(t, async () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'x' }),
  }));
  assert.deepEqual(codeOf(await thrown(() => getCourseContents('tok', '1'))), {
    code: 'moodle_ws_error',
    params: { errorcode: 'invalidtoken', detail: 'x' },
  });

  globalThis.fetch = async () => ({
    status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    json: async () => null,
  });
  assert.deepEqual(codeOf(await thrown(() => getCourseContents('tok', '1'))), {
    code: 'site_blocked',
    params: { detail: 'HTTP 200, text/html; charset=utf-8' },
  });
});

test('a pluginfile that serves JSON instead of the file', async (t) => {
  stubFetch(t, async () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({}),
  }));
  const { assertPluginfileReadable } = await import('../src/moodle/wsClient.js');
  const url = pluginfileUrl('https://lemida.biu.ac.il/webservice/pluginfile.php/1/x.pdf', 't');
  assert.deepEqual(codeOf(await thrown(() => assertPluginfileReadable(url))), {
    code: 'moodle_file_unreadable',
    params: { url },
  });
});

// ── what a link turns out to be ─────────────────────────────────────────────

test('a dead link, a non-video file and a web page are three different codes', async (t) => {
  stubFetch(t, async () => ({ ok: false, status: 404, body: { cancel: async () => {} } }));
  const dead = await thrown(() =>
    resolveDirectUrl({
      recording: directUrlRecording('https://files.test/e1/gone.mp4'),
      course: 'C',
      name: 'L',
      kind: 'lecture',
    }),
  );
  assert.deepEqual(codeOf(dead), {
    code: 'link_dead',
    params: { url: 'https://files.test/e1/gone.mp4' },
  });

  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    body: { cancel: async () => {} },
  });
  const slides = await thrown(() =>
    resolveDirectUrl({
      recording: directUrlRecording('https://files.test/e2/deck.pptx'),
      course: 'C',
      name: 'L',
      kind: 'lecture',
    }),
  );
  assert.deepEqual(codeOf(slides), {
    code: 'link_not_a_video',
    params: { source: 'link', url: 'https://files.test/e2/deck.pptx', ext: 'pptx' },
  });

  // `ext: null` is what says "a web page", so the frontend needs no second code for it.
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
    body: { cancel: async () => {} },
  });
  const page = await thrown(() =>
    resolveDirectUrl({
      recording: directUrlRecording('https://files.test/e3/watch'),
      course: 'C',
      name: 'L',
      kind: 'lecture',
    }),
  );
  assert.deepEqual(codeOf(page), {
    code: 'link_not_a_video',
    params: { source: 'link', url: 'https://files.test/e3/watch', ext: null },
  });
});

test('a host that answers nothing useful stays inconclusive, not unsupported', async (t) => {
  stubFetch(t, async () => {
    throw new Error('ECONNREFUSED');
  });
  const err = await thrown(() =>
    resolveDirectUrl({
      recording: directUrlRecording('https://files.test/e4/opaque'),
      course: 'C',
      name: 'L',
      kind: 'lecture',
    }),
  );
  assert.deepEqual(codeOf(err), {
    code: 'link_probe_inconclusive',
    params: { url: 'https://files.test/e4/opaque' },
  });
  assert.equal(err instanceof UnsupportedError, false); // a 500 the row stays clickable after
});

test('a Drive link that is not a file link, and one nobody shared', async (t) => {
  assert.deepEqual(
    codeOf(await thrown(() => probeDriveFile('https://drive.google.com/drive/folders/x'))),
    {
      code: 'drive_link_malformed',
      params: { url: 'https://drive.google.com/drive/folders/x' },
    },
  );

  stubFetch(t, async () => ({ status: 200, headers: { get: () => null }, text: async () => '' }));
  const url = 'https://drive.google.com/file/d/1unshared-fixture-id/view';
  assert.deepEqual(codeOf(await thrown(() => probeDriveFile(url))), {
    code: 'drive_not_shared',
    params: { url },
  });
});

test('an expandable row whose target is not YouTube', async () => {
  const err = await thrown(() =>
    new YoutubePlaylistExtractor().listEntries({ pageUrl: 'https://vimeo.com/showcase/1' }),
  );
  assert.deepEqual(codeOf(err), { code: 'expand_unsupported_host', params: { host: 'vimeo.com' } });
});

// ── the HTTP bodies ─────────────────────────────────────────────────────────

test('every request-validation body names the field that was wrong', async () => {
  const cases = [
    [{ scope: 'course' }, 'course'],
    [{ course: 'C', scope: 'section' }, 'scope'],
    [{ course: 'C', scope: 'lecture' }, 'name'],
    [{ course: 'C', name: 'L', scope: 'lecture' }, 'passcode'],
  ];
  for (const [body, field] of cases) {
    const res = fakeRes();
    handleZoomPasscode({ body }, res);
    assert.equal(res.code, 400);
    assert.deepEqual(
      { code: res.body.code, params: res.body.params },
      {
        code: 'invalid_request',
        params: { field },
      },
    );
  }
});

test('/resolve rejects a ref, a name and a kind it cannot use', async () => {
  const ref = encodeRef({ strategy: 'direct-url', pageUrl: 'https://files.test/x.mp4' });
  const cases = [
    [{ ref: 'not-a-ref' }, 'ref'],
    [{ ref, course: 'C', name: '../escape' }, 'name'],
    [{ ref, course: 'C', name: 'L', kind: 'material' }, 'kind'],
  ];
  for (const [body, field] of cases) {
    const res = fakeRes();
    await handleResolve({ body }, res);
    assert.equal(res.code, 400);
    assert.deepEqual(
      { code: res.body.code, params: res.body.params },
      {
        code: 'invalid_request',
        params: { field },
      },
    );
  }
});

// ── the four typed refusals ─────────────────────────────────────────────────

const COURSE_URL = 'https://lemida.biu.ac.il/course/view.php?id=109063';

test('401 steers to Reconnect and says so in a code', async () => {
  fs.rmSync(TOKEN_FILE, { force: true });
  const res = fakeRes();
  await handleList({ body: { courseUrl: COURSE_URL } }, res);
  assert.equal(res.code, 401);
  assert.deepEqual(res.body, {
    status: 'reconnect',
    code: 'moodle_reconnect_required',
    params: {},
  });
});

test('503 carries what the site served instead of an answer', async (t) => {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ wstoken: 'tok', privatetoken: 'p' }));
  t.after(() => fs.rmSync(TOKEN_FILE, { force: true }));
  stubFetch(t, async () => ({
    status: 200,
    headers: { get: () => 'text/html' },
    json: async () => null,
  }));

  const res = fakeRes();
  await handleList({ body: { courseUrl: COURSE_URL } }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.status, 'blocked');
  assert.deepEqual(
    { code: res.body.code, params: res.body.params },
    { code: 'site_blocked', params: { detail: 'HTTP 200, text/html' } },
  );
});

test('422 relays the thrower\'s code rather than one flat "unsupported"', async () => {
  const res = fakeRes();
  await handleListExpand(
    { body: { ref: encodeRef({ strategy: 'youtube-playlist', pageUrl: 'https://vimeo.com/1' }) } },
    res,
  );
  assert.equal(res.code, 422);
  assert.equal(res.body.status, 'unsupported');
  assert.deepEqual(
    { code: res.body.code, params: res.body.params },
    { code: 'expand_unsupported_host', params: { host: 'vimeo.com' } },
  );

  // The same relay from the backstop's side, for an UnsupportedError raised anywhere else.
  const direct = fakeRes();
  sendUnsupported(direct, new UnsupportedError('link_dead', { url: 'u' }, 'gone'));
  assert.deepEqual(direct.body, {
    status: 'unsupported',
    message: 'gone',
    code: 'link_dead',
    params: { url: 'u' },
  });
});

test('409 fills in the course and lecture the gate itself never knew', () => {
  const res = fakeRes();
  sendPasscode(res, new PasscodeError('incorrect'), { course: 'C', name: 'L1' });
  assert.equal(res.code, 409);
  assert.deepEqual(res.body, {
    status: 'passcode',
    reason: 'incorrect',
    course: 'C',
    name: 'L1',
    code: 'zoom_passcode_required',
    params: { reason: 'incorrect', course: 'C', name: 'L1' },
  });
});
