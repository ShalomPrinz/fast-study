// macOS: the zoom browser launches with no Xvfb and no off-screen park, its app is hidden by pid once
// the page exists, and a captcha unhides it, raises it, and hides it again. Fakes only, no osascript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  browserPid,
  configureMacHide,
  macHider,
  osascriptCommand,
} from '../src/browser/macHide.js';
import { usesXvfb, zoomLaunchArgs } from '../src/browser/zoomBrowser.js';
import {
  awaitCaptchaSolve,
  configureZoomCaptcha,
  raiseZoomCaptcha,
  requireCaptchaWindow,
  zoomOpened,
} from '../src/browser/zoomCaptcha.js';
import { configureWindowStyle } from '../src/browser/windowStyle.js';

const SHARE = 'https://zoom.test/rec/share/abc';
const PID = 4242;

// A Playwright browser whose CDP reports `processes`; `fail` makes the session itself reject.
function fakeBrowser({ processes = [{ type: 'browser', id: PID }], fail = false } = {}) {
  const browser = { detached: 0 };
  browser.newBrowserCDPSession = async () => {
    if (fail) throw new Error('cdp gone');
    return {
      send: async (method) => {
        assert.equal(method, 'SystemInfo.getProcessInfo');
        return { processInfo: processes };
      },
      detach: async () => {
        browser.detached++;
      },
    };
  };
  return browser;
}

// The fake osascript spawn: logs 'hide:<pid>' / 'show:<pid>' into `log`.
function fakeRun(t, log, run) {
  t.after(
    configureMacHide({
      run: async (pid, action) => {
        log.push(`${action}:${pid}`);
        return run?.(pid, action);
      },
    }),
  );
}

function quietWarn(t) {
  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(line);
  t.after(() => (console.warn = warn));
  return warnings;
}

test('launch args: darwin keeps a hidden window rendering and carries no off-screen park', () => {
  const mac = zoomLaunchArgs('darwin', false);
  assert.ok(mac.includes('--disable-backgrounding-occluded-windows'));
  assert.ok(!mac.some((a) => a.startsWith('--window-position')));
  assert.ok(!mac.some((a) => a.startsWith('--faststudy-window')));
  assert.deepEqual(zoomLaunchArgs('darwin', true), mac);
});

test('launch args: Windows and Linux are unchanged', () => {
  const base = ['--mute-audio', '--disable-blink-features=AutomationControlled'];
  assert.deepEqual(zoomLaunchArgs('linux', false), base);
  assert.deepEqual(zoomLaunchArgs('win32', true), base);
  assert.deepEqual(zoomLaunchArgs('win32', false), [
    ...base,
    '--window-position=-32000,-32000',
    '--faststudy-window=zoom',
  ]);
});

test('Xvfb is for Linux only', () => {
  assert.equal(usesXvfb('linux'), true);
  assert.equal(usesXvfb('win32'), false);
  assert.equal(usesXvfb('darwin'), false);
});

test('the osascript spawn runs JXA with the pid and the action as its arguments', () => {
  const { file, args } = osascriptCommand(PID, 'hide');
  assert.equal(file, '/usr/bin/osascript');
  assert.deepEqual(args.slice(0, 3), ['-l', 'JavaScript', '-e']);
  assert.deepEqual(args.slice(4), [String(PID), 'hide']);
  assert.match(args[3], /NSRunningApplication\.runningApplicationWithProcessIdentifier/);
  assert.doesNotMatch(args[3], /System Events/);
});

test("browserPid is the CDP browser process's id, not a renderer's", async () => {
  const browser = fakeBrowser({
    processes: [
      { type: 'renderer', id: 7 },
      { type: 'browser', id: PID },
      { type: 'GPU', id: 9 },
    ],
  });
  assert.equal(await browserPid(browser), PID);
  assert.equal(browser.detached, 1);
});

test('the hider runs its changes one at a time, in call order, on the browser pid', async (t) => {
  const log = [];
  let release;
  fakeRun(t, log, (_pid, action) => {
    if (action === 'show') return new Promise((r) => (release = r));
  });
  const hider = macHider(fakeBrowser());
  void hider.hide();
  void hider.show();
  const last = hider.hide();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log, [`hide:${PID}`, `show:${PID}`], 'the second hide waits for the show');
  release();
  await last;
  assert.deepEqual(log, [`hide:${PID}`, `show:${PID}`, `hide:${PID}`]);
});

test('a failed spawn or an unknown pid never rejects, and warns once', async (t) => {
  const warnings = quietWarn(t);
  const log = [];
  fakeRun(t, log, () => {
    throw new Error('exit 1');
  });
  const hider = macHider(fakeBrowser());
  await hider.hide();
  await hider.show();
  assert.equal(log.length, 2);
  assert.equal(warnings.length, 1);

  const blind = macHider(fakeBrowser({ fail: true }));
  await blind.hide();
  await blind.show();
  assert.equal(log.length, 2, 'no spawn without a pid');
  assert.equal(warnings.length, 2);
});

test('macOS: a captcha is not refused', (t) => {
  t.after(configureZoomCaptcha({ platform: 'darwin' }));
  assert.doesNotThrow(() => requireCaptchaWindow(SHARE, 'frame'));
  assert.doesNotThrow(() => requireCaptchaWindow(SHARE, 'noPlayer'));
});

// A zoom page waiting on a captcha on macOS until `solve()`; one ordered log of spawns and window steps.
function macWait(t, { solveMs = 60_000 } = {}) {
  t.after(configureZoomCaptcha({ platform: 'darwin', solveMs }));
  const log = [];
  fakeRun(t, log);
  // The Windows styler must never run on macOS.
  t.after(
    configureWindowStyle({ platform: 'win32', run: async () => void log.push('powershell') }),
  );
  const view = new EventEmitter();
  let done = false;
  const page = {
    log,
    solve() {
      done = true;
      view.emit('solved');
    },
    bringToFront: async () => void log.push('front'),
    context: () => ({
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
          const b = params.bounds;
          log.push(b.windowState ? `state:${b.windowState}` : `move:${b.left}`);
          await page.onStep?.(b);
          return {};
        },
        detach: async () => {},
      }),
    }),
    waitForSelector: (_sel, { timeout }) =>
      new Promise((resolve, reject) => {
        if (done) return resolve({});
        const timer = setTimeout(() => {
          const err = new Error('Timeout exceeded');
          err.name = 'TimeoutError';
          reject(err);
        }, timeout);
        view.once('solved', () => (clearTimeout(timer), resolve({})));
      }),
    isVisible: async (sel) => !sel.includes('iframe'),
  };
  return page;
}

const RAISE = ['state:normal', 'move:80', 'state:minimized', 'state:normal', 'front'];
const settle = () => new Promise((r) => setTimeout(r, 10));

test('macOS: hidden once opened; a captcha unhides before the raise and hides after the solve, never parked', async (t) => {
  const page = macWait(t);
  zoomOpened(fakeBrowser());
  const wait = awaitCaptchaSolve(page, SHARE, async () => {});
  await settle();
  assert.deepEqual(page.log, [`hide:${PID}`, `show:${PID}`, ...RAISE]);
  page.solve();
  await wait;
  await settle();
  assert.deepEqual(page.log, [`hide:${PID}`, `show:${PID}`, ...RAISE, `hide:${PID}`]);
});

test('macOS: an unsolved captcha times out and hides the app again', async (t) => {
  const page = macWait(t, { solveMs: 40 });
  zoomOpened(fakeBrowser());
  await assert.rejects(
    awaitCaptchaSolve(page, SHARE, async () => {}),
    (err) => err.code === 'zoom_captcha_timeout',
  );
  await settle();
  assert.deepEqual(page.log, [`hide:${PID}`, `show:${PID}`, ...RAISE, `hide:${PID}`]);
});

test('macOS: a raise unhides and activates again, and a wait ending mid-raise ends hidden', async (t) => {
  const page = macWait(t);
  zoomOpened(fakeBrowser());
  const wait = awaitCaptchaSolve(page, SHARE, async () => {});
  await settle();
  page.log.length = 0;

  assert.equal(await raiseZoomCaptcha(), true);
  assert.deepEqual(page.log, [`show:${PID}`, ...RAISE]);

  page.log.length = 0;
  page.onStep = async (step) => {
    if (step.windowState !== 'minimized') return;
    page.onStep = null;
    page.solve();
    await wait;
  };
  assert.equal(await raiseZoomCaptcha(), true);
  await settle();
  assert.equal(page.log.at(-1), `hide:${PID}`);
  assert.ok(!page.log.includes('move:-32000'));
});

test('macOS: FASTSTUDY_ZOOM_VISIBLE=1 hides nothing', async (t) => {
  process.env.FASTSTUDY_ZOOM_VISIBLE = '1';
  t.after(() => delete process.env.FASTSTUDY_ZOOM_VISIBLE);
  const page = macWait(t);
  zoomOpened(fakeBrowser());
  const wait = awaitCaptchaSolve(page, SHARE, async () => {});
  await settle();
  page.solve();
  await wait;
  await settle();
  assert.deepEqual(page.log, RAISE);
});
