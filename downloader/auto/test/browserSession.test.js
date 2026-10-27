// The zoom browser session survives a user closing its window: the next open() relaunches, and a
// capture cut off mid-way answers 503 zoom_browser_closed, never the 500 backstop. Fake browsers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BrowserSession, browserClosed, configureSessions } from '../src/browser/browserSession.js';
import { handleResolve } from '../src/http/server.js';
import { encodeRef } from '../src/lib/ref.js';

// Playwright's own error for a call on a closed page, as its client raises it.
function targetClosed(method) {
  const err = new Error(`${method}: Target page, context or browser has been closed`);
  err.name = 'TargetClosedError';
  return err;
}

// A browser whose window the test can "close by hand": the page closes, then the browser disconnects.
function fakeBrowser({ goto } = {}) {
  const browser = new EventEmitter();
  let closed = false;
  const page = Object.assign(new EventEmitter(), {
    isClosed: () => closed,
    url: () => 'about:blank',
    goto: goto ?? (async () => {}),
    waitForRequest: () => new Promise(() => {}),
    evaluate: async () => {},
  });
  browser.page = page;
  browser.newContext = async () => ({ newPage: async () => page });
  browser.close = async () => browser.userClose();
  browser.userClose = () => {
    if (closed) return;
    closed = true;
    page.emit('close');
    browser.emit('disconnected');
  };
  return browser;
}

function fakeLauncher(make = fakeBrowser) {
  const launched = [];
  const launch = async () => {
    const b = make();
    launched.push(b);
    return b;
  };
  return { launch, launched };
}

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
    on() {},
  };
  return res;
}

test('a browser the user closed is forgotten, and the next open() launches a fresh one', async (t) => {
  const { launch, launched } = fakeLauncher();
  const session = new BrowserSession(launch);
  t.after(() => session.close());

  await session.open();
  assert.equal(launched.length, 1);
  await session.open();
  assert.equal(launched.length, 1, 'an open session is reused');

  launched[0].userClose();
  assert.equal(session.isOpen(), false);
  assert.equal(session.browser, null);

  await session.open();
  assert.equal(launched.length, 2);
  assert.equal(session.page, launched[1].page);
});

test('a closed page alone drops the session too', async (t) => {
  const { launch, launched } = fakeLauncher();
  const session = new BrowserSession(launch);
  t.after(() => session.close());

  await session.open();
  launched[0].page.emit('close');
  await session.open();
  assert.equal(launched.length, 2);
});

test('concurrent first opens share one launch', async (t) => {
  const { launch, launched } = fakeLauncher();
  const session = new BrowserSession(launch);
  t.after(() => session.close());

  await Promise.all([session.open(), session.open()]);
  assert.equal(launched.length, 1);
});

test('browserClosed knows Playwright closed-target errors and a closed page', () => {
  assert.equal(browserClosed(targetClosed('page.goto')), true);
  assert.equal(browserClosed(new Error('boom'), { isClosed: () => true }), true);
  assert.equal(browserClosed(new Error('boom'), { isClosed: () => false }), false);
  const plain = new Error('page.goto: Target page, context or browser has been closed');
  assert.equal(browserClosed(plain, null), true);
  assert.equal(browserClosed(plain, { isClosed: () => false }), true);
});

test('a zoom capture whose window is closed mid-way answers 503 zoom_browser_closed, then relaunches', async (t) => {
  // The first browser's goto finds its window closed by the user; the second one is never reached.
  let first = true;
  const { launch, launched } = fakeLauncher(() => {
    const b = fakeBrowser({
      goto: async () => {
        if (!first) throw new Error('second capture stops here');
        first = false;
        b.userClose();
        throw targetClosed('page.goto');
      },
    });
    return b;
  });
  t.after(configureSessions({ zoom: launch }));
  const ref = encodeRef({
    title: 'L',
    pageUrl: 'https://zoom.us/rec/share/abc',
    kind: 'lecture',
    strategy: 'zoom',
  });
  const body = { ref, course: 'C', name: 'L', forceCapture: true };

  const res = fakeRes();
  await handleResolve({ body, headers: { 'x-faststudy-moodle-wait': '1' } }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'zoom_browser_closed');
  assert.match(res.body.params.detail, /Target page, context or browser has been closed/);
  assert.equal('status' in res.body, false, 'never read as a bot wall');

  // The retry launches a fresh browser instead of reusing the dead page.
  await assert.rejects(
    handleResolve({ body, headers: { 'x-faststudy-moodle-wait': '1' } }, fakeRes()),
    /second capture stops here/,
  );
  assert.equal(launched.length, 2);
});

test('the idle close never fires under a locked op, and is re-armed when it ends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { launch, launched } = fakeLauncher();
  const session = new BrowserSession(launch);
  t.after(() => session.close());

  await session.withLock(async () => {
    await session.open();
    t.mock.timers.tick(60 * 60 * 1000); // an hour-long capture
    assert.equal(session.isOpen(), true, 'still open mid-op');
  });
  t.mock.timers.tick(44 * 60 * 1000);
  assert.equal(session.isOpen(), true, 'the 45-min clock starts when the op ends');
  t.mock.timers.tick(2 * 60 * 1000);
  await Promise.resolve();
  assert.equal(session.isOpen(), false);
  assert.equal(launched.length, 1);
});

test('a window closed during the launch answers 503 zoom_browser_closed, not the backstop', async (t) => {
  const { launch } = fakeLauncher(() => {
    const b = fakeBrowser();
    b.newContext = async () => {
      throw targetClosed('browser.newContext');
    };
    return b;
  });
  t.after(configureSessions({ zoom: launch }));
  const ref = encodeRef({
    title: 'L',
    pageUrl: 'https://zoom.us/rec/share/abc',
    kind: 'lecture',
    strategy: 'zoom',
  });

  const res = fakeRes();
  await handleResolve(
    { body: { ref, course: 'C', name: 'L', forceCapture: true }, headers: {} },
    res,
  );
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'zoom_browser_closed');
});
