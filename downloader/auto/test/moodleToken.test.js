// disconnect() is a local-only forget; a headed login the user closes is abandoned, not left pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MoodleToken } from '../src/auth/moodleToken.js';

const SITE = 'https://moodle.test';

function tokenPathIn(dir) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), dir)), 'auth', 'moodle-token.json');
}

test('disconnect deletes a stored token and clears the invalidated flag', async () => {
  const tokenPath = tokenPathIn('moodle-token-');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify({ site: SITE, wstoken: 'abc', privatetoken: null }));
  const auth = new MoodleToken({ tokenPath, site: SITE });
  auth.markExpired();
  assert.deepEqual(auth.status(), { connected: true, expired: true });

  await auth.disconnect();

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(auth.status(), { connected: false, expired: false });
});

test('disconnect with no token stored succeeds', async () => {
  const tokenPath = tokenPathIn('moodle-token-missing-');
  const auth = new MoodleToken({ tokenPath, site: SITE });
  assert.deepEqual(auth.status(), { connected: false, expired: false });

  await auth.disconnect();
  await auth.disconnect(); // idempotent: nothing to delete is not an error

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(auth.status(), { connected: false, expired: false });
});

// Enough of a Playwright browser for connect(): pages close like a user closing a window, and the
// browser disconnects only on close() — as a real one does when its last window goes.
function fakeBrowser() {
  const browser = new EventEmitter();
  const context = new EventEmitter();
  const open = [];
  context.pages = () => [...open];
  context.newPage = async () => {
    const page = new EventEmitter();
    page.goto = async () => {};
    page.close = () => {
      open.splice(open.indexOf(page), 1);
      page.emit('close');
    };
    open.push(page);
    context.emit('page', page);
    return page;
  };
  browser.newContext = async () => context;
  browser.connected = true;
  browser.close = async () => {
    if (!browser.connected) return;
    browser.connected = false;
    browser.emit('disconnected');
  };
  return { browser, context, launch: async () => browser };
}

test('closing the login window before a token cancels the pending login', async () => {
  const { browser, context, launch } = fakeBrowser();
  const auth = new MoodleToken({ tokenPath: tokenPathIn('moodle-abandon-'), site: SITE, launch });
  let cancelled = 0;
  await auth.connect({ onCancel: () => cancelled++ });

  context.pages()[0].close();

  assert.equal(browser.connected, false);
  assert.equal(cancelled, 1);
  const err = await auth.complete().then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, 'moodle_login_not_pending');
});

test('a login popup keeps the login pending until its last window closes', async () => {
  const { browser, context, launch } = fakeBrowser();
  const auth = new MoodleToken({ tokenPath: tokenPathIn('moodle-popup-'), site: SITE, launch });
  await auth.connect();
  const popup = await context.newPage();

  context.pages()[0].close();
  assert.equal(browser.connected, true);

  popup.close();
  assert.equal(browser.connected, false);
});

test('closing the window while complete() waits fails it at once', async () => {
  const { context, launch } = fakeBrowser();
  const auth = new MoodleToken({ tokenPath: tokenPathIn('moodle-inflight-'), site: SITE, launch });
  await auth.connect();
  const done = auth.complete().then(
    () => null,
    (e) => e,
  );

  context.pages()[0].close();

  const err = await done;
  assert.equal(err.code, 'moodle_login_abandoned');
});

// ── the post-login check ────────────────────────────────────────────────────

const APPTOKEN = Buffer.from('sig:::harness-wstoken:::harness-private').toString('base64');

function stubSiteInfo(t, info) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = async () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => info,
  });
}

const fn = (...names) => names.map((name) => ({ name, version: '2024100700' }));
const FULL = fn('core_course_get_contents', 'tool_mobile_get_autologin_key');

// A headed login that has captured its token redirect, ready for complete().
async function capturedLogin(dir) {
  const { context, launch } = fakeBrowser();
  const tokenPath = tokenPathIn(dir);
  const auth = new MoodleToken({ tokenPath, site: SITE, launch });
  await auth.connect();
  context.pages()[0].emit('framenavigated', { url: () => `moodlemobile://token=${APPTOKEN}` });
  return { auth, tokenPath };
}

test('complete() persists the site and userid beside the token', async (t) => {
  stubSiteInfo(t, { userid: 7, downloadfiles: 1, release: '4.5', functions: FULL });
  const { auth, tokenPath } = await capturedLogin('moodle-ok-');
  await auth.complete();
  const stored = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  assert.deepEqual(
    { site: stored.site, wstoken: stored.wstoken, privatetoken: stored.privatetoken },
    { site: SITE, wstoken: 'harness-wstoken', privatetoken: 'harness-private' },
  );
  assert.equal(stored.userid, 7);
  assert.deepEqual(auth.status(), { connected: true, expired: false });
});

for (const [reason, info, extra] of [
  [
    'missing_function',
    { userid: 7, downloadfiles: 1, functions: fn('tool_mobile_get_autologin_key') },
    { function: 'core_course_get_contents' },
  ],
  ['downloads_disabled', { userid: 7, downloadfiles: 0, functions: FULL }, {}],
  ['downloads_disabled', { userid: 7, functions: FULL }, {}],
]) {
  test(`complete() refuses ${reason} and persists nothing`, async (t) => {
    stubSiteInfo(t, info);
    const { auth, tokenPath } = await capturedLogin(`moodle-${reason}-`);
    const err = await auth.complete().then(
      () => null,
      (e) => e,
    );
    assert.deepEqual(
      { code: err.code, params: err.params },
      { code: 'moodle_site_unsupported', params: { site: SITE, reason, ...extra } },
    );
    assert.equal(fs.existsSync(tokenPath), false);
    assert.deepEqual(auth.status(), { connected: false, expired: false });
  });
}

test('complete() connects when only autologin is missing', async (t) => {
  stubSiteInfo(t, { userid: 7, downloadfiles: 1, functions: fn('core_course_get_contents') });
  const { auth } = await capturedLogin('moodle-noautologin-');
  await auth.complete();
  assert.deepEqual(auth.status(), { connected: true, expired: false });
});

test('a token minted for another site reads as not connected', () => {
  const tokenPath = tokenPathIn('moodle-othersite-');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify({ site: 'https://other.test', wstoken: 'abc' }));
  const auth = new MoodleToken({ tokenPath, site: SITE });
  assert.equal(auth.loadToken(), null);
  assert.deepEqual(auth.status(), { connected: false, expired: false });
  assert.deepEqual(new MoodleToken({ tokenPath, site: 'https://other.test' }).status(), {
    connected: true,
    expired: false,
  });
});
