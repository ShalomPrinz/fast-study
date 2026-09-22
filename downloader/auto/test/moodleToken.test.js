// disconnect() is a local-only forget; a headed login the user closes is abandoned, not left pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MoodleToken } from '../src/auth/moodleToken.js';

function tokenPathIn(dir) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), dir)), 'auth', 'biu-token.json');
}

test('disconnect deletes a stored token and clears the invalidated flag', async () => {
  const tokenPath = tokenPathIn('moodle-token-');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify({ wstoken: 'abc', privatetoken: null }));
  const auth = new MoodleToken({ tokenPath });
  auth.markExpired();
  assert.deepEqual(auth.status(), { connected: true, expired: true });

  await auth.disconnect();

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(auth.status(), { connected: false, expired: false });
});

test('disconnect with no token stored succeeds', async () => {
  const tokenPath = tokenPathIn('moodle-token-missing-');
  const auth = new MoodleToken({ tokenPath });
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
  const auth = new MoodleToken({ tokenPath: tokenPathIn('moodle-abandon-'), launch });
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
  const auth = new MoodleToken({ tokenPath: tokenPathIn('moodle-popup-'), launch });
  await auth.connect();
  const popup = await context.newPage();

  context.pages()[0].close();
  assert.equal(browser.connected, true);

  popup.close();
  assert.equal(browser.connected, false);
});

test('closing the window while complete() waits fails it at once', async () => {
  const { context, launch } = fakeBrowser();
  const auth = new MoodleToken({ tokenPath: tokenPathIn('moodle-inflight-'), launch });
  await auth.connect();
  const done = auth.complete().then(
    () => null,
    (e) => e,
  );

  context.pages()[0].close();

  const err = await done;
  assert.equal(err.code, 'moodle_login_abandoned');
});
