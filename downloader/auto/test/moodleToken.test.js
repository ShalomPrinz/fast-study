// disconnect() is a local-only forget; a headed login the user closes is abandoned, not left pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MoodleToken } from '../src/auth/moodleToken.js';
import { readTokenFile, writeTokenFile } from '../src/auth/tokenStore.js';

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
  assert.deepEqual(auth.status(), { connected: true, expired: true, unverified: false });

  await auth.disconnect();

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(auth.status(), { connected: false, expired: false, unverified: false });
});

test('disconnect with no token stored succeeds', async () => {
  const tokenPath = tokenPathIn('moodle-token-missing-');
  const auth = new MoodleToken({ tokenPath, site: SITE });
  assert.deepEqual(auth.status(), { connected: false, expired: false, unverified: false });

  await auth.disconnect();
  await auth.disconnect(); // idempotent: nothing to delete is not an error

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(auth.status(), { connected: false, expired: false, unverified: false });
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
  assert.deepEqual(auth.status(), { connected: true, expired: false, unverified: false });
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
    assert.deepEqual(auth.status(), { connected: false, expired: false, unverified: false });
  });
}

test('complete() connects when only autologin is missing', async (t) => {
  stubSiteInfo(t, { userid: 7, downloadfiles: 1, functions: fn('core_course_get_contents') });
  const { auth } = await capturedLogin('moodle-noautologin-');
  await auth.complete();
  assert.deepEqual(auth.status(), { connected: true, expired: false, unverified: false });
});

test('a token minted for another site reads as not connected', () => {
  const tokenPath = tokenPathIn('moodle-othersite-');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify({ site: 'https://other.test', wstoken: 'abc' }));
  const auth = new MoodleToken({ tokenPath, site: SITE });
  assert.equal(auth.loadToken(), null);
  assert.deepEqual(auth.status(), { connected: false, expired: false, unverified: false });
  assert.deepEqual(new MoodleToken({ tokenPath, site: 'https://other.test' }).status(), {
    connected: true,
    expired: false,
    unverified: false,
  });
});

// ── Encrypted token file ────────────────────────────────────────────────────

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

function withKey(t, key) {
  const prev = process.env.FASTSTUDY_TOKEN_KEY;
  if (key === undefined) delete process.env.FASTSTUDY_TOKEN_KEY;
  else process.env.FASTSTUDY_TOKEN_KEY = key;
  t.after(() => {
    if (prev === undefined) delete process.env.FASTSTUDY_TOKEN_KEY;
    else process.env.FASTSTUDY_TOKEN_KEY = prev;
  });
}

test('token file round trips encrypted: no plaintext on disk, fresh IV per write', (t) => {
  withKey(t, KEY);
  const file = tokenPathIn('tok-enc-');
  const record = { site: SITE, wstoken: 'secret-wstoken', privatetoken: null, userid: 3 };
  writeTokenFile(file, record);
  const first = fs.readFileSync(file, 'utf8');
  assert.equal(first.includes('secret-wstoken'), false);
  assert.deepEqual(readTokenFile(file), record);
  writeTokenFile(file, record);
  assert.notEqual(JSON.parse(first).iv, JSON.parse(fs.readFileSync(file, 'utf8')).iv);
});

test('a wrong key, a tampered file or a missing key reads as absent', (t) => {
  withKey(t, KEY);
  const file = tokenPathIn('tok-bad-');
  writeTokenFile(file, { site: SITE, wstoken: 'abc' });
  withKey(t, OTHER_KEY);
  assert.equal(readTokenFile(file), null);
  withKey(t, KEY);
  const env = JSON.parse(fs.readFileSync(file, 'utf8'));
  env.data = Buffer.from('tampered').toString('base64');
  fs.writeFileSync(file, JSON.stringify(env));
  assert.equal(readTokenFile(file), null);
  fs.writeFileSync(file, 'not json');
  assert.equal(readTokenFile(file), null);
  writeTokenFile(file, { site: SITE, wstoken: 'abc' });
  withKey(t, undefined);
  assert.equal(readTokenFile(file), null);
});

test('with no key the file stays plaintext', (t) => {
  withKey(t, undefined);
  const file = tokenPathIn('tok-plain-');
  writeTokenFile(file, { site: SITE, wstoken: 'abc' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).wstoken, 'abc');
});

test('a legacy plaintext token is read and rewritten encrypted when a key is set', (t) => {
  withKey(t, KEY);
  const file = tokenPathIn('tok-legacy-');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ site: SITE, wstoken: 'legacy' }));
  assert.equal(readTokenFile(file).wstoken, 'legacy');
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.equal(onDisk.includes('legacy'), false);
  assert.equal(readTokenFile(file).wstoken, 'legacy');
});

// ── Block, unverified token, re-entrant complete ────────────────────────────

function stubSequence(t, ...answers) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async () => {
    calls.push(1);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a;
  });
  return calls;
}
const jsonRes = (body) => ({
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
});
const challengeRes = () => ({ status: 200, headers: { get: () => 'text/html' } });
const GOOD = { userid: 7, downloadfiles: 1, functions: FULL };

// A fake launch that records each browser it opens and the pages it navigated to.
function recordingLaunch() {
  const opened = [];
  const launch = async () => {
    const f = fakeBrowser();
    const origNew = f.browser.newContext;
    f.browser.newContext = async () => {
      const ctx = await origNew();
      const np = ctx.newPage;
      ctx.newPage = async () => {
        const page = await np();
        page.goto = async (url) => opened.push(url);
        return page;
      };
      return ctx;
    };
    f.browser.fake = f;
    return f.browser;
  };
  return { launch, opened };
}

async function captured(t, dir) {
  const rec = recordingLaunch();
  const tokenPath = tokenPathIn(dir);
  const auth = new MoodleToken({ tokenPath, site: SITE, launch: rec.launch });
  await auth.connect();
  rec.opened.length = 0;
  // Reach the login page through the fake: emit the token redirect on the first page.
  return { auth, tokenPath, rec };
}

async function loginAndCapture(auth) {
  const page = auth._pending.context.pages()[0];
  page.emit('framenavigated', { url: () => `moodlemobile://token=${APPTOKEN}` });
}

test('a block keeps the token unverified, opens the site root; the next complete() verifies it', async (t) => {
  withKey(t, undefined);
  stubSequence(t, challengeRes(), jsonRes(GOOD));
  const { auth, tokenPath, rec } = await captured(t, 'blk-');
  await loginAndCapture(auth);
  const err = await auth.complete().then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, 'site_blocked');
  assert.equal(err.params.challengeWindow, true);
  assert.deepEqual(rec.opened, [SITE]);
  assert.deepEqual(auth.status(), { connected: true, expired: false, unverified: true });
  assert.equal(JSON.parse(fs.readFileSync(tokenPath, 'utf8')).userid, null);

  const window = auth._challenge;
  const record = await auth.complete();
  assert.equal(record.userid, 7);
  assert.deepEqual(auth.status(), { connected: true, expired: false, unverified: false });
  assert.equal(window.connected, false);
  assert.equal(auth._challenge, null);
});

test('a second block reuses the open challenge window', async (t) => {
  withKey(t, undefined);
  stubSequence(t, challengeRes(), challengeRes());
  const { auth, rec } = await captured(t, 'blk2-');
  await loginAndCapture(auth);
  await auth.complete().catch(() => {});
  await auth.complete().catch(() => {});
  assert.deepEqual(rec.opened, [SITE]);
});

test('verifiedToken() verifies an unverified token before first use, once for concurrent callers', async (t) => {
  withKey(t, undefined);
  const calls = stubSequence(t, jsonRes(GOOD));
  const tokenPath = tokenPathIn('lazy-');
  writeTokenFile(tokenPath, { site: SITE, wstoken: 'w', userid: null, unverified: true });
  const auth = new MoodleToken({ tokenPath, site: SITE });
  const [a, b] = await Promise.all([auth.verifiedToken(), auth.verifiedToken()]);
  assert.equal(a.userid, 7);
  assert.equal(b.userid, 7);
  assert.equal(calls.length, 1);
  assert.equal(auth.status().unverified, false);
});

test('complete() with nothing pending or stored is not_pending', async (t) => {
  withKey(t, undefined);
  const auth = new MoodleToken({ tokenPath: tokenPathIn('none-'), site: SITE });
  const err = await auth.complete().catch((e) => e);
  assert.equal(err.code, 'moodle_login_not_pending');
});

async function unverifiedAuth(dir) {
  const tokenPath = tokenPathIn(dir);
  writeTokenFile(tokenPath, { site: SITE, wstoken: 'w', userid: null, unverified: true });
  return {
    auth: new MoodleToken({ tokenPath, site: SITE, launch: recordingLaunch().launch }),
    tokenPath,
  };
}

test('invalidtoken revokes the stored token', async (t) => {
  withKey(t, undefined);
  stubSequence(t, jsonRes({ exception: 'x', errorcode: 'invalidtoken', message: 'bad' }));
  const { auth, tokenPath } = await unverifiedAuth('rev-inv-');
  const err = await auth.complete().catch((e) => e);
  assert.equal(err.errorcode, 'invalidtoken');
  assert.equal(fs.existsSync(tokenPath), false);
});

test('an unsupported site revokes the stored token', async (t) => {
  withKey(t, undefined);
  stubSequence(t, jsonRes({ userid: 7, downloadfiles: 0, functions: FULL }));
  const { auth, tokenPath } = await unverifiedAuth('rev-unsup-');
  const err = await auth.complete().catch((e) => e);
  assert.equal(err.code, 'moodle_site_unsupported');
  assert.equal(fs.existsSync(tokenPath), false);
});

test('a block or a network failure never revokes', async (t) => {
  withKey(t, undefined);
  stubSequence(t, challengeRes(), new TypeError('fetch failed'));
  const { auth, tokenPath } = await unverifiedAuth('keep-');
  assert.equal((await auth.complete().catch((e) => e)).code, 'site_blocked');
  assert.equal((await auth.complete().catch((e) => e)).name, 'TypeError');
  assert.equal(fs.existsSync(tokenPath), true);
  assert.equal(auth.status().unverified, true);
});

test('disconnect and a new connect() close the challenge window', async (t) => {
  withKey(t, undefined);
  stubSequence(t, challengeRes(), challengeRes());
  const { auth } = await unverifiedAuth('close-');
  await auth.complete().catch(() => {});
  const first = auth._challenge;
  await auth.connect();
  assert.equal(first.connected, false);
  await auth.disconnect();
});
