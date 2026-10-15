// POST /window/show: raises the zoom window and the challenge window while each waits on a captcha
// (on screen, minimized, restored, in front), 409 no_window_waiting with neither, behind the secret.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FASTSTUDY_SECRET = 'launch-secret';

import express from 'express';
import { requireSecret } from '@faststudy/runtime';
import { handleWindowShow } from '../src/http/server.js';
import { awaitCaptchaSolve, configureZoomCaptcha } from '../src/browser/zoomCaptcha.js';
import { openChallenge } from '../src/moodle/challenge.js';
import { gated } from './gated.js';
import { fakeProfile } from './fakeProfile.js';

const SITE = 'https://moodle.test';
const SHARE = 'https://zoom.test/rec/share/abc';
const HEADERS = { 'X-FastStudy-Secret': 'launch-secret' };
const RAISE = [
  { windowState: 'normal' },
  { left: 80, top: 80 },
  { windowState: 'minimized' },
  { windowState: 'normal' },
];

async function serve(t) {
  const app = express();
  app.use(requireSecret);
  app.post('/window/show', handleWindowShow);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const show = async (base, headers = HEADERS) => {
  const res = await fetch(`${base}/window/show`, { method: 'POST', headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// A zoom page on screen for a captcha until the test solves it; records its window steps.
async function zoomWait(t, { onStep } = {}) {
  t.after(configureZoomCaptcha({ platform: 'win32', solveMs: 60_000 }));
  let solve;
  const solved = new Promise((r) => (solve = r));
  const page = {
    steps: [],
    fronted: 0,
    bringToFront: async () => {
      page.fronted++;
    },
    context: () => ({
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
          page.steps.push(params.bounds);
          await onStep?.(params.bounds, solve);
          return {};
        },
        detach: async () => {},
      }),
    }),
    waitForSelector: () => solved,
    isVisible: async (sel) => !sel.includes('iframe'),
  };
  const done = awaitCaptchaSolve(page, SHARE, async () => {});
  page.done = done;
  t.after(async () => {
    solve();
    await done;
  });
  // Past the wait's own move on screen, so a test sees only what the route does.
  await new Promise((r) => setTimeout(r, 10));
  page.steps.length = 0;
  page.fronted = 0;
  return page;
}

async function challengeCaptcha(t) {
  const profile = fakeProfile(t, { lands: 'captcha' });
  assert.equal(await gated(() => openChallenge(SITE)), 'captcha');
  const [ctx] = profile.launches;
  ctx.steps.length = 0;
  ctx.fronted = 0;
  return ctx;
}

test('nothing waiting answers 409 no_window_waiting', async (t) => {
  const base = await serve(t);
  assert.deepEqual(await show(base), {
    status: 409,
    body: { error: 'no window is waiting on a captcha', code: 'no_window_waiting', params: {} },
  });
});

test('the launch secret guards the route', async (t) => {
  const base = await serve(t);
  const page = await zoomWait(t);
  assert.equal((await show(base, {})).status, 401);
  assert.equal((await show(base, { 'X-FastStudy-Secret': 'wrong' })).status, 401);
  assert.deepEqual(page.steps, []);
  assert.equal(page.fronted, 0);
});

test('a zoom captcha wait raises the zoom window', async (t) => {
  const base = await serve(t);
  const page = await zoomWait(t);
  assert.deepEqual(await show(base), { status: 200, body: { raised: ['zoom'] } });
  assert.deepEqual(page.steps, RAISE);
  assert.equal(page.fronted, 1);
});

test('a challenge captcha raises the challenge window', async (t) => {
  const base = await serve(t);
  const ctx = await challengeCaptcha(t);
  assert.deepEqual(await show(base), { status: 200, body: { raised: ['challenge'] } });
  assert.deepEqual(ctx.steps, RAISE);
  assert.equal(ctx.fronted, 1);
});

test('a challenge window up with no captcha is not waiting', async (t) => {
  const base = await serve(t);
  const profile = fakeProfile(t);
  assert.equal(await gated(() => openChallenge(SITE)), 'ready');
  assert.equal((await show(base)).status, 409);
  assert.deepEqual(profile.launches[0].steps, []);
});

test('both waiting raises both', async (t) => {
  const base = await serve(t);
  const page = await zoomWait(t);
  const ctx = await challengeCaptcha(t);
  assert.deepEqual(await show(base), { status: 200, body: { raised: ['zoom', 'challenge'] } });
  assert.deepEqual(page.steps, RAISE);
  assert.deepEqual(ctx.steps, RAISE);
});

test('a zoom wait ending mid-raise leaves the window off-screen', async (t) => {
  const base = await serve(t);
  let page;
  page = await zoomWait(t, {
    onStep: async (step, solve) => {
      if (step.windowState !== 'minimized') return;
      solve();
      await page.done;
    },
  });
  assert.deepEqual(await show(base), { status: 200, body: { raised: ['zoom'] } });
  assert.deepEqual(page.steps.at(-1), { left: -32000, top: -32000 });
});

test('a challenge solved mid-raise leaves the window off-screen', async (t) => {
  const base = await serve(t);
  const ctx = await challengeCaptcha(t);
  const open = ctx.newCDPSession;
  ctx.newCDPSession = async () => {
    const cdp = await open();
    const send = cdp.send;
    cdp.send = async (method, params) => {
      const out = await send(method, params);
      if (params?.bounds.windowState === 'minimized') {
        ctx.solve(SITE);
        await new Promise((r) => setTimeout(r, 10));
      }
      return out;
    };
    return cdp;
  };
  assert.deepEqual(await show(base), { status: 200, body: { raised: ['challenge'] } });
  assert.deepEqual(ctx.steps.at(-1), { left: -32000, top: -32000 });
});
