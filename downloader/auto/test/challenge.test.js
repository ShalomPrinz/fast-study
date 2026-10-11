// Block mode: a blocked Moodle call opens one headed persistent window on the site; while it is up,
// Moodle calls go out from its page with its launch UA (the real Chrome UA plus MoodleMobile), and
// the window is on screen holding the lock only while a captcha waits. A fake profile stands in for Chrome (test/fakeProfile.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { statePath } from '@faststudy/runtime';
import { gated } from './gated.js';
import { fakeProfile, CAPTCHA_URL, CHROME_UA } from './fakeProfile.js';
import { moodleGate } from '../src/moodle/gate.js';
import { setCurrentSite } from '../src/moodle/site.js';
import { writeTokenFile } from '../src/auth/tokenStore.js';
import { handleList } from '../src/http/server.js';
import { siteAuth, authState, authEvents } from '../src/core/registry.js';
import {
  openChallenge,
  closeChallenge,
  reportBlock,
  challengeState,
  challengeEvents,
  challengeRoute,
  configureChallenge,
} from '../src/moodle/challenge.js';
import {
  getCourseContents,
  getAutologinKey,
  openPluginfile,
  openMoodleFile,
  WsBlockedError,
} from '../src/moodle/wsClient.js';

const SITE = 'https://moodle.test';
const tick = () => new Promise((r) => setImmediate(r));

// Records every fetch; `answer(url, init)` decides what each one gets.
function stubFetch(t, answer) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  });
  return calls;
}

const json = (body) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const html = () =>
  new Response('<html>captcha</html>', { headers: { 'content-type': 'text/html' } });
// A page fetch tells itself apart from Node's by the init the window always sends.
const fromPage = (init) => init.redirect === 'manual' && init.credentials === 'include';

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

// ── The launch and the window-state rule ────────────────────────────────────

test('the window launches headed on the persistent profile, always off-screen', async (t) => {
  const profile = fakeProfile(t);
  assert.equal(await gated(() => openChallenge(SITE)), 'ready');
  const [ctx] = profile.launches;
  assert.equal(ctx.dir, statePath('moodle-profile'));
  assert.equal(path.basename(ctx.dir), 'moodle-profile');
  assert.equal(ctx.opts.headless, false);
  assert.equal(ctx.opts.viewport, null);
  assert.ok(ctx.opts.args.includes('--window-position=-32000,-32000'));
  // The real Chrome UA plus MoodleMobile, from the first visit: switching it later is walled.
  assert.equal(ctx.opts.userAgent, `${CHROME_UA} MoodleMobile`);
  // Landing on the site: the clearance holds, so it stays hidden and holds no lock.
  assert.deepEqual(ctx.visited, [SITE]);
  assert.deepEqual(ctx.bounds, []);
  assert.equal(ctx.fronted, 0);
  assert.deepEqual(challengeState(), { open: true, captcha: false });
  assert.equal(moodleGate.busy(), false);
});

test('landing on a captcha brings the window on screen and in front', async (t) => {
  const profile = fakeProfile(t, { lands: 'captcha' });
  const seen = [];
  const onChange = () => seen.push(challengeState());
  challengeEvents.on('change', onChange);
  t.after(() => challengeEvents.off('change', onChange));
  assert.equal(await moodleGate.run({}, () => openChallenge(SITE)), 'captcha');
  const [ctx] = profile.launches;
  assert.deepEqual(ctx.bounds, [{ left: 80, top: 80 }]);
  assert.equal(ctx.fronted, 1);
  assert.deepEqual(challengeState(), { open: true, captcha: true });
  assert.deepEqual(seen.at(-1), { open: true, captcha: true });
  // A second block while it is up reuses it.
  assert.equal(await moodleGate.run({}, () => openChallenge(SITE)), 'captcha');
  assert.equal(profile.launches.length, 1);
  await closeChallenge();
  assert.deepEqual(seen.at(-1), { open: false, captcha: false });
});

test('no browser launching reports false and leaves block mode off', async (t) => {
  // The sandbox launcher throws, as a machine with no Chrome, Edge or Chromium does.
  t.after(configureChallenge({ userAgent: async () => CHROME_UA }));
  assert.equal(await gated(() => openChallenge(SITE)), false);
  assert.deepEqual(challengeState(), { open: false, captcha: false });
});

test('an unknown browser UA launches no window: a clearance under a non-app UA is no use', async (t) => {
  const profile = fakeProfile(t);
  t.after(configureChallenge({ userAgent: async () => null }));
  assert.equal(await gated(() => openChallenge(SITE)), false);
  assert.equal(profile.launches.length, 0);
  assert.deepEqual(challengeState(), { open: false, captcha: false });
});

// ── The transport switch ────────────────────────────────────────────────────

test('in block mode a WS call goes out from the page, carrying no UA header of its own', async (t) => {
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const calls = stubFetch(t, () => json([{ id: 1 }]));
  assert.deepEqual(await gated(() => getCourseContents(SITE, 'tok', '5')), [{ id: 1 }]);
  assert.equal(calls.length, 1);
  const { init } = calls[0];
  assert.ok(fromPage(init));
  assert.equal(init.cache, 'no-store');
  assert.equal(init.method, 'GET');
  assert.equal(
    init.headers.some(([name]) => name === 'user-agent'),
    false,
  );
});

test('a page fetch drops any User-Agent, so the window context UA applies', async (t) => {
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const calls = stubFetch(t, () => json({}));
  const res = await challengeRoute(`${SITE}/x`).fetch(`${SITE}/x`, {
    headers: { 'User-Agent': 'MoodleMobile 4.4.0 (44000)', Accept: 'application/json' },
  });
  await res.body?.cancel();
  assert.deepEqual(calls[0].init.headers, [['accept', 'application/json']]);
});

test('a form-encoded POST crosses into the page as a string body', async (t) => {
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const calls = stubFetch(t, () => json({}));
  const res = await challengeRoute(`${SITE}/x`).fetch(`${SITE}/x`, {
    method: 'POST',
    body: new URLSearchParams({ privatetoken: 'priv' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  await res.body?.cancel();
  const { init } = calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.body, 'privatetoken=priv');
  assert.deepEqual(
    init.headers.find(([n]) => n === 'content-type'),
    ['content-type', 'application/x-www-form-urlencoded'],
  );
});

test("the page's unreadable redirect reads as a 302, so the wall check still fires", async (t) => {
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  stubFetch(t, () => ({ type: 'opaqueredirect', status: 0 }));
  const err = await gated(() => getCourseContents(SITE, 'tok', '5')).catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  assert.equal(err.params.detail, 'HTTP 302 redirect');
});

test('a ranged PDF streams back from the page whole, across several slices', async (t) => {
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const bytes = new Uint8Array(9 * 1024 * 1024 + 7).map((_, i) => i % 251);
  const calls = stubFetch(
    t,
    () =>
      new Response(bytes, {
        status: 206,
        headers: {
          'content-type': 'application/pdf',
          'content-range': `bytes 5-${bytes.length + 4}/${bytes.length + 5}`,
        },
      }),
  );
  const res = await gated(() =>
    openPluginfile(`${SITE}/pluginfile.php/1/a.pdf?token=t`, { range: 'bytes=5-' }),
  );
  assert.deepEqual(
    calls[0].init.headers.find(([n]) => n === 'range'),
    ['range', 'bytes=5-'],
  );
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-length'), String(bytes.length));
  assert.equal(res.headers.get('content-range'), `bytes 5-${bytes.length + 4}/${bytes.length + 5}`);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
});

test('a page still on the captcha sends nothing and answers blocked', async (t) => {
  fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  const calls = stubFetch(t, () => json({}));
  const err = await moodleGate.run({}, () => getCourseContents(SITE, 'tok', '5')).catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  assert.equal(calls.length, 0);
});

test('a replayed-cookie file and an off-site URL stay on Node in block mode', async (t) => {
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const calls = stubFetch(t, () => new Response('v', { headers: { 'content-type': 'video/mp4' } }));
  await gated(() => openMoodleFile(`${SITE}/v.mp4`, { headers: [] }));
  await gated(() => openPluginfile('https://other.test/pluginfile.php/a.pdf'));
  assert.equal(calls.length, 2);
  assert.equal(
    calls.some(({ init }) => fromPage(init)),
    false,
  );
});

// ── The captcha's hold on the lock ──────────────────────────────────────────

test('a captcha holds the lock for the user: a retry is admitted, a queued call waits for it', async (t) => {
  const profile = fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  const [ctx] = profile.launches;
  // The frontend may press: moodleBusy reads false while only the captcha holds the lock.
  assert.equal(moodleGate.busy(), false);
  const calls = stubFetch(t, () => json([]));

  let queuedRan = false;
  const queued = moodleGate.run({ wait: true }, async () => {
    await getCourseContents(SITE, 'tok', '1');
    queuedRan = true;
  });
  await tick();
  assert.equal(queuedRan, false);

  // Unsolved, the retry is admitted but sends nothing.
  const early = await moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.ok(early instanceof WsBlockedError);
  assert.equal(calls.length, 0);

  // Solved: the page landing back on the site lets the lock go and moves the window off-screen,
  // with no call needed (the user's retry may be a replay-cache hit), so the queued call runs.
  ctx.solve(SITE);
  await queued;
  assert.equal(queuedRan, true);
  assert.deepEqual(ctx.bounds.at(-1), { left: -32000, top: -32000 });
  assert.deepEqual(challengeState(), { open: true, captcha: false });
  assert.equal(calls.length, 1);
  assert.ok(fromPage(calls[0].init));
});

test('a captcha raised again during an admitted retry still admits the next retry', async (t) => {
  const profile = fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  const [ctx] = profile.launches;
  await moodleGate.run({}, async () => {
    await moodleGate.enter('x'); // admitted on top of the captcha's hold
    ctx.solve(SITE);
    await tick();
    // A later call in the same retry is walled: the window lands on the captcha again.
    assert.equal(await openChallenge(SITE), 'captcha');
  });
  assert.deepEqual(challengeState(), { open: true, captcha: true });
  assert.equal(moodleGate.busy(), false);
  await moodleGate.run({}, () => moodleGate.enter('x'));
});

test('the user closing the window mid-call ends block mode with an unrouted site_blocked', async (t) => {
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  ctx.page.evaluate = async () => {
    await ctx.close();
    const err = new Error('Target page, context or browser has been closed');
    err.name = 'TargetClosedError';
    throw err;
  };
  const err = await gated(() => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  assert.equal(err.routed, false);
  await gated(() => reportBlock(err, SITE));
  assert.equal('challengeWindow' in err.params, false);
  assert.equal(profile.launches.length, 1);
  assert.deepEqual(challengeState(), { open: false, captcha: false });
});

test('only one retry runs on a captcha at a time', async (t) => {
  fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  let release;
  const held = new Promise((r) => (release = r));
  const first = moodleGate.run({}, async () => {
    await moodleGate.enter('x');
    await held;
  });
  await tick();
  const second = await moodleGate.run({}, () => moodleGate.enter('x')).catch((e) => e);
  assert.equal(second.code, 'moodle_busy');
  release();
  await first;
});

// ── Block mode off ──────────────────────────────────────────────────────────

test('the user closing the window ends block mode; the next block relaunches on the profile', async (t) => {
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  await profile.launches[0].close();
  assert.deepEqual(challengeState(), { open: false, captcha: false });
  const calls = stubFetch(t, () => json([]));
  await gated(() => getCourseContents(SITE, 'tok', '1'));
  assert.equal(fromPage(calls[0].init), false);
  assert.equal(await gated(() => openChallenge(SITE)), 'ready');
  assert.equal(profile.launches.length, 2);
  assert.equal(profile.launches[1].dir, profile.launches[0].dir);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a minute with no call through it (shortened here) closes the window, keeping the profile', async (t) => {
  const profile = fakeProfile(t, { idleMs: 20 });
  await gated(() => openChallenge(SITE));
  await sleep(60);
  assert.equal(profile.launches[0].closed, true);
  assert.equal(fs.existsSync(profile.launches[0].dir), true);
  assert.deepEqual(challengeState(), { open: false, captcha: false });
});

test('a captcha on screen gets the longer timeout; solving it starts the short one', async (t) => {
  const profile = fakeProfile(t, { lands: 'captcha', idleMs: 20, captchaMs: 10_000 });
  await moodleGate.run({}, () => openChallenge(SITE));
  const [ctx] = profile.launches;
  await sleep(60);
  assert.equal(ctx.closed, false);
  ctx.solve(SITE);
  await sleep(60);
  assert.equal(ctx.closed, true);
});

test('a body paused mid-read holds off the short close until it is cancelled', async (t) => {
  const profile = fakeProfile(t, { idleMs: 20, captchaMs: 10_000 });
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  const bytes = new Uint8Array(9 * 1024 * 1024);
  stubFetch(t, () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
  const res = await gated(() => openPluginfile(`${SITE}/pluginfile.php/1/a.pdf?token=t`));
  const reader = res.body.getReader();
  await reader.read(); // one slice, then the reader pauses
  await sleep(60);
  assert.equal(ctx.closed, false);
  await reader.cancel();
  await sleep(60);
  assert.equal(ctx.closed, true);
});

test('a walled answer through the page leaves the short idle close in effect', async (t) => {
  const profile = fakeProfile(t, { idleMs: 20, captchaMs: 10_000 });
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  stubFetch(t, () => html());
  const err = await gated(() => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  await sleep(60);
  assert.equal(ctx.closed, true);
});

test('a call still running through the window holds off the idle close', async (t) => {
  const profile = fakeProfile(t, { idleMs: 20 });
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  stubFetch(t, async () => {
    await sleep(80);
    return json([{ id: 1 }]);
  });
  assert.deepEqual(await gated(() => getCourseContents(SITE, 'tok', '1')), [{ id: 1 }]);
  assert.equal(ctx.closed, false);
  await sleep(60);
  assert.equal(ctx.closed, true);
});

// ── Every site_blocked 503 carries the window's state ───────────────────────

test('a blocked /list opens the window and its 503 says whether a captcha waits', async (t) => {
  setCurrentSite(SITE);
  t.after(() => setCurrentSite(null));
  writeTokenFile(statePath('auth', 'moodle-token.json'), { site: SITE, wstoken: 'w', userid: 7 });
  const profile = fakeProfile(t, { lands: 'captcha' });
  stubFetch(t, (url, init) => (fromPage(init) ? json([]) : html()));
  const res = fakeRes();
  await handleList({ body: { courseUrl: `${SITE}/course/view.php?id=5` } }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'site_blocked');
  assert.equal(res.body.params.challengeWindow, 'captcha');
  assert.equal(profile.launches[0].page.url(), CAPTCHA_URL);

  // The user solves it and repeats the action: it passes through the window.
  profile.launches[0].solve(SITE);
  const again = fakeRes();
  await handleList({ body: { courseUrl: `${SITE}/course/view.php?id=5` } }, again);
  assert.equal(again.code, 200);
  assert.deepEqual(challengeState(), { open: true, captcha: false });
});

test('a block on an unrouted path opens no window and carries no challengeWindow', async (t) => {
  const profile = fakeProfile(t);
  stubFetch(t, () => html());
  const err = await gated(() => openMoodleFile(`${SITE}/v.mp4`, { headers: [] })).catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  await gated(() => reportBlock(err, SITE));
  assert.equal('challengeWindow' in err.params, false);
  assert.equal(profile.launches.length, 0);
  assert.deepEqual(challengeState(), { open: false, captcha: false });
});

test('the window closing between the head and the body is the same unrouted site_blocked', async (t) => {
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  const evaluate = ctx.page.evaluate;
  ctx.page.evaluate = async (fn, arg) => {
    if (fn.name !== 'pageChunk') return evaluate(fn, arg);
    await ctx.close();
    const err = new Error('Target page, context or browser has been closed');
    err.name = 'TargetClosedError';
    throw err;
  };
  stubFetch(t, () => json([{ id: 1 }]));
  const err = await gated(() => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  assert.equal(err.routed, false);
});

test('a page that navigated away and dropped the body fails the stream as site_blocked', async (t) => {
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  const evaluate = ctx.page.evaluate;
  ctx.page.evaluate = async (fn, arg) => (fn.name === 'pageChunk' ? null : evaluate(fn, arg));
  stubFetch(t, () => new Response('%PDF-1', { headers: { 'content-type': 'application/pdf' } }));
  const res = await gated(() => openPluginfile(`${SITE}/pluginfile.php/1/a.pdf?token=t`));
  const err = await res.arrayBuffer().catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  assert.equal(err.routed, false);
});

// ── A wall on Node retries through the window ───────────────────────────────

function onSite(t) {
  setCurrentSite(SITE);
  t.after(() => setCurrentSite(null));
}

test('a walled Node call reopens the window hidden and is resent through it, unseen by the caller', async (t) => {
  onSite(t);
  const profile = fakeProfile(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? json([{ id: 1 }]) : html()));
  assert.deepEqual(await gated(() => getCourseContents(SITE, 'tok', '5')), [{ id: 1 }]);
  assert.equal(profile.launches.length, 1);
  assert.deepEqual(challengeState(), { open: true, captcha: false });
  // The same call went out twice: once on Node, once from the page.
  assert.equal(calls.length, 2);
  assert.equal(fromPage(calls[0].init), false);
  assert.ok(fromPage(calls[1].init));
});

test('a WS fault answered through the window logs the window route', async (t) => {
  onSite(t);
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  stubFetch(t, () => json({ exception: 'x', errorcode: 'nopermissions', message: 'no' }));
  const warn = t.mock.method(console, 'warn', () => {});
  const err = await gated(() => getCourseContents(SITE, 'tok', '5')).catch((e) => e);
  assert.equal(err.params.errorcode, 'nopermissions');
  assert.match(warn.mock.calls[0].arguments[0], /nopermissions via window/);
});

// tool_mobile_get_autologin_key needs a MoodleMobile UA, which the window's browser never sends.
test('the autologin key stays on Node while the window is open', async (t) => {
  onSite(t);
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const calls = stubFetch(t, () => json({ key: 'k', autologinurl: `${SITE}/a`, warnings: [] }));
  assert.equal((await gated(() => getAutologinKey(SITE, 'tok', 'priv'))).key, 'k');
  assert.equal(calls.length, 1);
  assert.equal(fromPage(calls[0].init), false);
  assert.equal(calls[0].init.headers['User-Agent'], 'MoodleMobile 4.4.0 (44000)');
  assert.equal(String(calls[0].init.body), 'privatetoken=priv');
});

test('a walled autologin key is an unrouted site_blocked that opens no window', async (t) => {
  onSite(t);
  const profile = fakeProfile(t);
  const calls = stubFetch(t, () => html());
  const err = await gated(() => getAutologinKey(SITE, 'tok', 'priv')).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.equal(err.code, 'site_blocked');
  assert.equal(err.routed, false);
  assert.equal(calls.length, 1);
  await reportBlock(err, SITE);
  assert.equal(profile.launches.length, 0);
  assert.equal('challengeWindow' in err.params, false);
});

test('a blocked /list after the window closed passes with no 503', async (t) => {
  onSite(t);
  writeTokenFile(statePath('auth', 'moodle-token.json'), { site: SITE, wstoken: 'w', userid: 7 });
  const profile = fakeProfile(t);
  stubFetch(t, (url, init) => (fromPage(init) ? json([]) : html()));
  await gated(() => openChallenge(SITE));
  await profile.launches[0].close();
  const res = fakeRes();
  await handleList({ body: { courseUrl: `${SITE}/course/view.php?id=5` } }, res);
  assert.equal(res.code, 200);
  assert.equal(profile.launches.length, 2);
});

test('a walled Node call that lands on a captcha throws once, the window opened once', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  stubFetch(t, () => html());
  const err = await moodleGate
    .run({}, async () => {
      const e = await getCourseContents(SITE, 'tok', '1').catch((x) => x);
      await reportBlock(e, SITE);
      return e;
    })
    .catch((e) => e);
  assert.equal(err.code, 'site_blocked');
  assert.equal(err.params.challengeWindow, 'captcha');
  assert.equal(err.params.detail, 'HTTP 200, text/html');
  assert.deepEqual(profile.launches[0].visited, [SITE]);
});

test('solving the captcha verifies the unverified token by itself, announced on authEvents', async (t) => {
  onSite(t);
  writeTokenFile(statePath('auth', 'moodle-token.json'), {
    site: SITE,
    wstoken: 'w',
    userid: null,
    unverified: true,
  });
  const profile = fakeProfile(t, { lands: 'captcha' });
  const GOOD = {
    userid: 7,
    downloadfiles: 1,
    functions: [{ name: 'core_course_get_contents' }, { name: 'tool_mobile_get_autologin_key' }],
  };
  stubFetch(t, (url, init) => (fromPage(init) ? json(GOOD) : html()));
  const { auth } = siteAuth();
  const err = await moodleGate.run({}, () => auth.complete()).catch((e) => e);
  assert.equal(err.params.challengeWindow, 'captcha');
  assert.equal(authState().phase, 'unverified');

  const connected = new Promise((resolve) => {
    const on = () => authState().phase === 'connected' && resolve(authState());
    authEvents.on('change', on);
    t.after(() => authEvents.off('change', on));
  });
  profile.launches[0].solve(SITE);
  const state = await connected;
  assert.equal(state.error, undefined);
  assert.equal(auth.loadToken().userid, 7);
  await auth.disconnect();
});
