// A WS call's answer is only a WS answer when it is JSON: the Moodle site is fronted by bot
// protection that serves an HTML captcha page (200) or a 302 to one when it decides a client is
// automated, so those are their own failure — not a WS fault, and not a JSON parse bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCourseContents,
  blocked,
  invalidToken,
  WsError,
  WsBlockedError,
} from '../src/moodle/wsClient.js';

// Minimal Response stand-in: callWs only reads status, content-type and json().
function stubFetch(t, { status = 200, contentType = 'application/json', body = null } = {}) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = async () => ({
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => JSON.parse(body),
  });
}

const CAPTCHA_HTML = '<!DOCTYPE html><html><head><title>Radware Captcha Page</title></head></html>';

test('an HTML challenge page under HTTP 200 is blocked, not a parse error', async (t) => {
  stubFetch(t, { contentType: 'text/html; charset=utf-8', body: CAPTCHA_HTML });
  const err = await getCourseContents('tok', '108980').then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.equal(blocked(err), true);
  assert.equal(invalidToken(err), false);
  assert.match(err.message, /refusing automated requests/);
  assert.match(err.message, /text\/html/);
});

test('a redirect to an HTML page is blocked', async (t) => {
  stubFetch(t, { status: 302, contentType: 'text/html' });
  const err = await getCourseContents('tok', '108980').then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.match(err.message, /HTTP 302 redirect/);
});

test('a missing content-type is blocked and says so', async (t) => {
  stubFetch(t, { contentType: null, body: '{}' });
  const err = await getCourseContents('tok', '108980').then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.match(err.message, /no content-type/);
});

test('a JSON answer still parses', async (t) => {
  stubFetch(t, { body: JSON.stringify([{ section: 1, modules: [] }]) });
  assert.deepEqual(await getCourseContents('tok', '108980'), [{ section: 1, modules: [] }]);
});

test('a WS exception body still throws WsError, unaffected by the JSON gate', async (t) => {
  stubFetch(t, {
    body: JSON.stringify({
      exception: 'moodle_exception',
      errorcode: 'invalidtoken',
      message: 'x',
    }),
  });
  const err = await getCourseContents('dead', '108980').then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsError);
  assert.equal(invalidToken(err), true);
  assert.equal(blocked(err), false);
});
