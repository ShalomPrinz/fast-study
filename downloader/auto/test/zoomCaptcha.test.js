// A captcha on a zoom share: shown on screen on Windows until solved, refused elsewhere, timed out
// after the solve budget, and cleared from /auth/events however it ends. Stub pages only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ZoomExtractor } from '../src/extractors/ZoomExtractor.js';
import {
  configureZoomCaptcha,
  zoomCaptchaEvents,
  zoomCaptchaState,
} from '../src/browser/zoomCaptcha.js';
import { configureSessions } from '../src/browser/browserSession.js';
import { handleResolve } from '../src/http/server.js';
import { encodeRef } from '../src/lib/ref.js';

const SHARE = 'https://zoom.test/rec/share/abc';
const MP4 = 'https://ssrweb.zoom.test/rec/clip.mp4?token=t';

function timeoutError() {
  const err = new Error('Timeout exceeded');
  err.name = 'TimeoutError';
  return err;
}

function targetClosed() {
  const err = new Error('page.waitForSelector: Target page, context or browser has been closed');
  err.name = 'TargetClosedError';
  return err;
}

// A share with a passcode gate (unless `gate` is false: no passcode stored, none asked). `afterGate` is what the right passcode reveals: the player, a
// captcha, or nothing. A captcha frame (`frame`) swallows clicks. `solve()` takes the frame away,
// `close()` is the user closing the window. Records each sniff's timeout, click and window move.
function captchaPage({ afterGate = 'captcha', frame = false, gate = true, player = false } = {}) {
  const ev = new EventEmitter();
  const page = Object.assign(ev, {
    gate,
    frame,
    player,
    closed: false,
    clicks: 0,
    selectors: [],
    sniffs: [],
    moves: [],
    fronted: 0,
    set(change) {
      Object.assign(page, change);
      ev.emit('view');
      if (change.player) setImmediate(() => ev.emit('request', fakeRequest()));
    },
    solve() {
      page.set(page.gate ? { frame: false } : { frame: false, player: true });
    },
    close() {
      page.set({ closed: true });
    },
    isClosed: () => page.closed,
    url: () => SHARE,
    goto: async () => {},
    bringToFront: async () => {
      page.fronted++;
    },
    context: () => ({
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
          if (params.bounds.left !== undefined) page.moves.push(params.bounds.left);
          return {};
        },
        detach: async () => {},
      }),
    }),
    isVisible: async (sel) => {
      page.selectors.push(sel);
      if (page.closed) throw targetClosed();
      return sel.includes('iframe') ? page.frame : page.player;
    },
    // What each selector the capture waits on sees right now; the gate's own 5s/3s waits are cut short.
    waitForSelector: (sel, { state = 'visible', timeout = 50 } = {}) => {
      // One clip: the multi-clip strip never shows.
      if (sel.startsWith('.vjs')) return Promise.reject(timeoutError());
      page.selectors.push(sel);
      const match = () => {
        if (state === 'detached' && sel.includes('iframe')) return !page.frame;
        if (state === 'detached') return !page.gate;
        return (
          (sel.includes('iframe') && page.frame) ||
          (sel.includes('input#passcode') && page.gate) ||
          (sel.includes('video') && page.player)
        );
      };
      if (sel.startsWith('input#passcode')) timeout = Math.min(timeout, 30);
      return new Promise((resolve, reject) => {
        const check = () => {
          if (page.closed) return done(reject, targetClosed());
          if (match()) return done(resolve, {});
        };
        const timer = setTimeout(() => done(reject, timeoutError()), timeout);
        const done = (fn, arg) => {
          clearTimeout(timer);
          ev.off('view', check);
          fn(arg);
        };
        ev.on('view', check);
        check();
      });
    },
    fill: async () => {},
    // The right passcode clears the gate unless a captcha frame sits over it.
    click: async () => {
      page.clicks++;
      if (page.frame) return;
      page.set({
        gate: false,
        frame: afterGate === 'captcha',
        player: afterGate === 'player',
      });
    },
    waitForRequest: (pred, { timeout }) => {
      page.sniffs.push(timeout);
      return new Promise((resolve, reject) => {
        const on = (req) => {
          if (!pred(req)) return;
          ev.off('request', on);
          resolve(req);
        };
        ev.on('request', on);
        setTimeout(() => reject(timeoutError()), timeout).unref();
      });
    },
    evaluate: async () => {},
  });
  return page;
}

function fakeRequest() {
  return { url: () => MP4, allHeaders: async () => ({ cookie: 'c=1' }) };
}

// Every zoomCaptcha publish, as the /auth/events stream would see it.
function recordStates(t) {
  const states = [];
  const on = () => states.push(zoomCaptchaState());
  zoomCaptchaEvents.on('change', on);
  t.after(() => zoomCaptchaEvents.off('change', on));
  return states;
}

const rec = { title: 'L', pageUrl: SHARE, kind: 'lecture', strategy: 'zoom' };

test('Windows: a captcha comes on screen, is published, and the capture continues once solved', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'win32', detectMs: 50, solveMs: 2000 }));
  const states = recordStates(t);
  const page = captchaPage();

  const capture = new ZoomExtractor()._captureVideo(page, rec, { passcode: '1234' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(zoomCaptchaState(), true, 'published while the captcha waits');
  assert.deepEqual(page.moves, [80], 'on screen');
  assert.equal(page.fronted, 1);
  page.solve();

  const caps = await capture;
  assert.equal(caps.length, 1);
  assert.equal(caps[0].url, MP4);
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(page.moves, [80, -32000], 'back off-screen');
  assert.deepEqual(page.sniffs, [30000, 2000 + 30000], 'the sniff is re-armed across the solve');
});

test('Windows: an unsolved captcha times out with zoom_captcha_timeout, state cleared, off-screen', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'win32', detectMs: 50, solveMs: 60 }));
  const states = recordStates(t);
  const page = captchaPage();

  await assert.rejects(
    new ZoomExtractor()._captureVideo(page, rec, { passcode: '1234' }),
    (err) => {
      assert.equal(err.code, 'zoom_captcha_timeout');
      assert.deepEqual(err.params, { url: SHARE });
      return true;
    },
  );
  assert.deepEqual(states, [true, false]);
  assert.equal(zoomCaptchaState(), false);
  assert.deepEqual(page.moves, [80, -32000]);
});

test('Linux: no player and no captcha frame past the gate is zoom_no_media_request', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'linux', detectMs: 30 }));
  const states = recordStates(t);
  const page = captchaPage({ afterGate: 'blank' });
  await assert.rejects(
    new ZoomExtractor()._captureVideo(page, rec, { passcode: '1234' }),
    (err) => {
      assert.equal(err.code, 'zoom_no_media_request');
      assert.deepEqual(err.params, { url: SHARE });
      return true;
    },
  );
  assert.deepEqual(states, []);
});

test('Windows: no player past the gate is shown on screen too, and continues once it plays', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'win32', detectMs: 30, solveMs: 2000 }));
  const states = recordStates(t);
  const page = captchaPage({ afterGate: 'blank' });
  let solvedCalls = 0;
  const capture = new ZoomExtractor()._captureVideo(page, rec, {
    passcode: '1234',
    onCaptchaSolved: () => solvedCalls++,
  });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(zoomCaptchaState(), true);
  assert.deepEqual(page.moves, [80]);
  page.solve();
  assert.equal((await capture)[0].url, MP4);
  assert.deepEqual(states, [true, false]);
  assert.equal(solvedCalls, 1);
});

test('a share with no captcha captures without showing the window', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'win32', detectMs: 50 }));
  const states = recordStates(t);
  const page = captchaPage({ afterGate: 'player' });
  const caps = await new ZoomExtractor()._captureVideo(page, rec, { passcode: '1234' });
  assert.equal(caps[0].url, MP4);
  assert.deepEqual(states, []);
  assert.deepEqual(page.moves, []);
});

test('a captcha over the passcode gate is a captcha, not an incorrect passcode', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'win32', detectMs: 50, solveMs: 2000 }));
  const states = recordStates(t);
  const page = captchaPage({ afterGate: 'player', frame: true });

  const capture = new ZoomExtractor()._captureVideo(page, rec, { passcode: '1234' });
  // Both attempts run with the real 2s pause between them before the captcha check.
  await new Promise((r) => setTimeout(r, 2120));
  assert.equal(zoomCaptchaState(), true, 'shown once the gate outlasts its attempts');
  assert.equal(page.clicks, 2);
  page.solve();

  const caps = await capture;
  assert.equal(caps[0].url, MP4);
  assert.equal(page.clicks, 3, 'the stored passcode is submitted again after the solve');
  assert.deepEqual(states, [true, false]);

  // Playwright checks a list's first DOM match only, so a hidden decoy (reCAPTCHA's idle bframe)
  // must not mask a visible frame: every captcha/player alternative filters on :visible itself.
  const own = page.selectors.filter((sel) => /iframe|video/.test(sel));
  assert.ok(own.length > 0);
  for (const sel of own) {
    for (const alt of sel.split(', ')) assert.match(alt, /:visible$/, alt);
  }
});

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

// A zoom session whose one page is `page`.
function sessionOn(t, page) {
  const browser = Object.assign(new EventEmitter(), {
    newContext: async () => ({ newPage: async () => page }),
    close: async () => {},
  });
  t.after(configureSessions({ zoom: async () => browser }));
}

const resolveBody = {
  ref: encodeRef(rec),
  course: 'C',
  name: 'L',
  kind: 'lecture',
  forceCapture: true,
};

test('non-Windows: a captcha answers 503 zoom_captcha_unsupported at once, nothing shown', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'linux', detectMs: 50, solveMs: 60_000 }));
  const states = recordStates(t);
  const page = captchaPage({ gate: false, frame: true });
  sessionOn(t, page);

  const res = fakeRes();
  await handleResolve({ body: resolveBody, headers: {} }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'zoom_captcha_unsupported');
  assert.deepEqual(res.body.params, { url: SHARE });
  assert.equal('status' in res.body, false);
  assert.deepEqual(states, [], 'never published');
  assert.deepEqual(page.moves, []);
});

test('a window closed mid-captcha answers zoom_browser_closed and clears the state', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'win32', detectMs: 50, solveMs: 60_000 }));
  const states = recordStates(t);
  const page = captchaPage({ gate: false, frame: true });
  sessionOn(t, page);

  const res = fakeRes();
  const done = handleResolve({ body: resolveBody, headers: {} }, res);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(zoomCaptchaState(), true);
  page.close();
  await done;
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'zoom_browser_closed');
  assert.deepEqual(states, [true, false]);
});

test('/resolve says captchaSolved:true only for the capture that waited on screen', async (t) => {
  t.after(configureZoomCaptcha({ platform: 'win32', detectMs: 50, solveMs: 2000 }));
  const page = captchaPage({ gate: false, frame: true });
  sessionOn(t, page);

  const res = fakeRes();
  const done = handleResolve({ body: resolveBody, headers: {} }, res);
  await new Promise((r) => setTimeout(r, 100));
  page.solve();
  await done;
  assert.equal(res.code, 200);
  assert.equal(res.body.captchaSolved, true);
  assert.equal(res.body.targets[0].url, MP4);

  // The next capture of a share with no captcha carries no flag.
  const clean = fakeRes();
  page.set({ player: true });
  await handleResolve({ body: resolveBody, headers: {} }, clean);
  assert.equal(clean.code, 200);
  assert.equal('captchaSolved' in clean.body, false);
});
