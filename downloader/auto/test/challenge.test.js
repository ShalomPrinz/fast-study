// Block mode: a blocked Moodle call opens one headed persistent window on the site; while it is up,
// Moodle calls go out from its page with its launch UA (the real Chrome UA plus MoodleMobile), and
// the window is on screen holding the lock only while a captcha waits. A fake profile stands in for Chrome (test/fakeProfile.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { statePath } from '@faststudy/runtime';
import { gated } from './gated.js';
import {
  fakeProfile,
  closedError,
  CAPTCHA_URL,
  CHROME_UA,
  MP4_URL,
  SESSION_COOKIE,
  loginUrlOf,
  isAutologin,
  hasSession,
} from './fakeProfile.js';
import { saveSessionCookies, loadSessionCookies } from '../src/auth/sessionCookies.js';
import { moodleGate } from '../src/moodle/gate.js';
import { setCurrentSite } from '../src/moodle/site.js';
import { writeTokenFile } from '../src/auth/tokenStore.js';
import { handleList, handleResolve } from '../src/http/server.js';
import { getSession } from '../src/browser/browserSession.js';
import { encodeRef } from '../src/lib/ref.js';
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

test('the autologin key goes out from the window while it is open, as a form POST', async (t) => {
  onSite(t);
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const calls = stubFetch(t, () => json({ key: 'k', autologinurl: `${SITE}/a`, warnings: [] }));
  assert.equal((await gated(() => getAutologinKey(SITE, 'tok', 'priv'))).key, 'k');
  assert.equal(calls.length, 1);
  assert.ok(fromPage(calls[0].init));
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, 'privatetoken=priv');
});

test('a walled autologin key reopens the window hidden and is resent through it', async (t) => {
  onSite(t);
  const profile = fakeProfile(t);
  const calls = stubFetch(t, (url, init) =>
    fromPage(init) ? json({ key: 'k', autologinurl: `${SITE}/a`, warnings: [] }) : html(),
  );
  assert.equal((await gated(() => getAutologinKey(SITE, 'tok', 'priv'))).key, 'k');
  assert.equal(profile.launches.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers['User-Agent'], 'MoodleMobile 4.4.0 (44000)');
  assert.ok(fromPage(calls[1].init));
});

// ── The page's own fetch is replaced by the site's scripts ──────────────────

test("a page call uses a hidden iframe's native fetch, made once per document", async (t) => {
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  // The page's fetch is the site's replacement; only the iframe's is native.
  const hooked = stubFetch(t, () => {
    throw new Error("the page's replaced fetch");
  });
  const native = [];
  const doc = ctx.document;
  const append = doc.documentElement.appendChild;
  doc.documentElement.appendChild = (el) => {
    append(el);
    el.contentWindow = {
      fetch: async (url) => {
        native.push(url);
        return json({});
      },
    };
  };
  const win = challengeRoute(`${SITE}/x`);
  for (const path of ['/x', '/y']) await (await win.fetch(`${SITE}${path}`)).body?.cancel();
  assert.deepEqual(native, [`${SITE}/x`, `${SITE}/y`]);
  assert.equal(hooked.length, 0);
  assert.equal(doc.frames, 1);
});

test('a page that navigated gets a new iframe on its next call', async (t) => {
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  stubFetch(t, () => json({}));
  const win = challengeRoute(`${SITE}/x`);
  await (await win.fetch(`${SITE}/x`)).body?.cancel();
  const before = ctx.document;
  await ctx.page.goto(`${SITE}/my/`);
  await (await win.fetch(`${SITE}/x`)).body?.cancel();
  assert.equal(before.frames, 1);
  assert.notEqual(ctx.document, before);
  assert.equal(ctx.document.frames, 1);
});

// ── A videostream capture logs in and sniffs in the Moodle browser ──────────

const VIDEOSTREAM_URL = `${SITE}/mod/videostream/view.php?id=3031600`;
const AUTOLOGIN_URL = `${SITE}/admin/tool/mobile/autologin.php?userid=7&key=k`;
const AUTOLOGIN_KEY = () =>
  json({ key: 'k', autologinurl: `${SITE}/admin/tool/mobile/autologin.php`, warnings: [] });
const keyCalls = (calls) => calls.filter((c) => c.url.includes('tool_mobile_get_autologin_key'));

// The plain session with a stand-in page that sees the player's .mp4 request, so no browser launches;
// like the window, it lands on the login until an autologin or the session cookie gives it a session.
function stubPlainSession(t) {
  const session = getSession('plain');
  const plain = { opened: false, added: [], visited: [], loggedIn: false, landed: 'about:blank' };
  t.mock.method(session, 'open', async () => {
    plain.opened = true;
    session.context = {
      addCookies: async (cookies) => {
        plain.added.push(...cookies);
        if (hasSession(cookies)) plain.loggedIn = true;
      },
      cookies: async () => [SESSION_COOKIE],
    };
    session.page = {
      goto: async (u) => {
        plain.visited.push(u);
        if (isAutologin(u)) plain.loggedIn = true;
        plain.landed = plain.loggedIn || u === 'about:blank' ? u : loginUrlOf(u);
      },
      url: () => plain.landed,
      evaluate: async () => {},
      waitForRequest: async () => ({
        url: () => MP4_URL,
        headers: () => ({ referer: VIDEOSTREAM_URL }),
        response: async () => null,
      }),
    };
  });
  t.after(() => session.close());
  return plain;
}

function videostreamResolve(t, token = { privatetoken: 'p' }) {
  onSite(t);
  writeTokenFile(statePath('auth', 'moodle-token.json'), {
    site: SITE,
    wstoken: 'w',
    userid: 7,
    ...token,
  });
  t.mock.method(console, 'log', () => {});
  // The saved session is on disk: forgetting it with the profile gives each test a fresh one.
  t.after(() => closeChallenge({ forget: true }));
  const run = async ({ forceCapture = true } = {}) => {
    const res = fakeRes();
    const ref = encodeRef({ strategy: 'videostream', pageUrl: VIDEOSTREAM_URL });
    await handleResolve({ body: { ref, course: 'C', name: 'L', forceCapture } }, res);
    return res;
  };
  return { run };
}

const LOGIN_URL = `${SITE}/login/index.php`;

test('with no saved session the autologin runs first and the module is captured once', async (t) => {
  const profile = fakeProfile(t);
  const plain = stubPlainSession(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  const res = await run();
  assert.equal(res.code, 200);
  const [ctx] = profile.launches;
  // Opened before the key, so the key went out from its page.
  assert.equal(calls.length, 1);
  assert.ok(fromPage(calls[0].init));
  // The root page took the autologin and stays there; the one module load ran in a second page, closed.
  assert.deepEqual(ctx.visited, [SITE, AUTOLOGIN_URL]);
  assert.equal(ctx.page.url(), AUTOLOGIN_URL);
  assert.deepEqual(
    ctx.capturePages.map((p) => [p.visited, p.url(), p.closed]),
    [[[VIDEOSTREAM_URL], VIDEOSTREAM_URL, true]],
  );
  assert.equal(plain.opened, false);
  assert.deepEqual(challengeState(), { open: true, captcha: false });
  // The autologin's session cookies are saved for the next launch.
  assert.deepEqual(loadSessionCookies(SITE), [SESSION_COOKIE]);
  // The off-site .mp4 is a plain curl target with the window's live headers, never proxied.
  const [target] = res.body.targets;
  assert.equal(target.url, MP4_URL);
  assert.equal(target.tool, 'curl');
  assert.ok(
    target.headers.some((h) => h.name === 'user-agent' && h.value === `${CHROME_UA} MoodleMobile`),
  );
});

test('a relaunched Moodle browser restores the saved session before its first page, spending no key', async (t) => {
  const profile = fakeProfile(t);
  stubPlainSession(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  assert.equal((await run()).code, 200);
  // The idle close ends the window, and its session cookie with it.
  await closeChallenge();
  assert.equal((await run()).code, 200);
  assert.equal(keyCalls(calls).length, 1);
  const second = profile.launches[1];
  assert.deepEqual(second.added, [SESSION_COOKIE]);
  assert.equal(second.addedBeforeVisit, true);
  assert.deepEqual(second.visited, [SITE]);
  assert.deepEqual(
    second.capturePages.map((p) => p.url()),
    [VIDEOSTREAM_URL],
  );
});

test('a session saved by an earlier process captures with no autologin key', async (t) => {
  const profile = fakeProfile(t);
  stubPlainSession(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  saveSessionCookies(SITE, [SESSION_COOKIE]);
  assert.equal((await run()).code, 200);
  assert.equal(calls.length, 0);
  assert.deepEqual(profile.launches[0].added, [SESSION_COOKIE]);
  assert.equal(profile.launches[0].capturePages.length, 1);
});

test('a dead saved session is captured on first, then autologins once and retries', async (t) => {
  const profile = fakeProfile(t);
  stubPlainSession(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  saveSessionCookies(SITE, [{ ...SESSION_COOKIE, name: 'other' }]);
  assert.equal((await run()).code, 200);
  assert.equal(keyCalls(calls).length, 1);
  assert.deepEqual(
    profile.launches[0].capturePages.map((p) => p.url()),
    [LOGIN_URL, VIDEOSTREAM_URL],
  );
});

test('a saved session captures even for a token with no privatetoken', async (t) => {
  fakeProfile(t);
  stubPlainSession(t);
  stubFetch(t, () => html());
  const { run } = videostreamResolve(t, {});
  saveSessionCookies(SITE, [SESSION_COOKIE]);
  assert.equal((await run()).code, 200);
});

test('a dead saved session with no privatetoken is moodle_token_no_privatetoken, after one load', async (t) => {
  const profile = fakeProfile(t);
  stubPlainSession(t);
  const calls = stubFetch(t, () => html());
  const { run } = videostreamResolve(t, {});
  saveSessionCookies(SITE, [{ ...SESSION_COOKIE, name: 'other' }]);
  const err = await run().then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.code, 'moodle_token_no_privatetoken');
  assert.equal(calls.length, 0);
  assert.equal(profile.launches[0].capturePages.length, 1);
});

test('still on the login after the autologin is videostream_login_required, one key spent', async (t) => {
  const profile = fakeProfile(t);
  stubPlainSession(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  // The autologin navigation passes, yet the module page still sends the browser to the login.
  const newPage = ctx.newPage;
  ctx.newPage = async () => {
    const page = await newPage();
    const goto = page.goto;
    page.goto = async (u) => {
      ctx.loggedIn = false;
      return goto(u);
    };
    return page;
  };
  const err = await run().then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.code, 'videostream_login_required');
  assert.deepEqual(err.params, { url: VIDEOSTREAM_URL });
  assert.equal(keyCalls(calls).length, 1);
  assert.equal(ctx.capturePages.length, 1);
});

test('a replay-cache hit answers with no window launch and no autologin key', async (t) => {
  const profile = fakeProfile(t);
  stubPlainSession(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  assert.equal((await run()).code, 200);
  await closeChallenge();
  const res = await run({ forceCapture: false });
  assert.equal(res.code, 200);
  assert.equal(res.body.targets[0].fromCache, true);
  assert.equal(res.body.targets[0].url, MP4_URL);
  assert.equal(profile.launches.length, 1);
  assert.equal(keyCalls(calls).length, 1);
  assert.equal(calls.length, 1);
});

test('the idle close waits for a capture running in the Moodle browser', async (t) => {
  const profile = fakeProfile(t, { idleMs: 20 });
  stubPlainSession(t);
  stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  saveSessionCookies(SITE, [SESSION_COOKIE]);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  const newPage = ctx.newPage;
  ctx.newPage = async () => {
    const page = await newPage();
    const goto = page.goto;
    page.goto = async (u) => {
      await new Promise((r) => setTimeout(r, 80));
      return goto(u);
    };
    return page;
  };
  const res = await run();
  assert.equal(res.code, 200);
  assert.equal(ctx.closed, false);
  // Idle again once the capture page is closed.
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(ctx.closed, true);
});

test('a capture that finds no .mp4 still closes its page and leaves the window up', async (t) => {
  const profile = fakeProfile(t);
  stubPlainSession(t);
  stubFetch(t, (url, init) => (fromPage(init) ? AUTOLOGIN_KEY() : html()));
  const { run } = videostreamResolve(t);
  saveSessionCookies(SITE, [SESSION_COOKIE]);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  const newPage = ctx.newPage;
  ctx.newPage = async () => Object.assign(await newPage(), { waitForRequest: async () => null });
  const err = await run().then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.code, 'videostream_no_media_request');
  assert.equal(ctx.capturePages[0].closed, true);
  assert.deepEqual(challengeState(), { open: true, captcha: false });
});

test('a window closed under the autologin navigation hands the key to the plain session', async (t) => {
  const profile = fakeProfile(t);
  const plain = stubPlainSession(t);
  stubFetch(t, () => AUTOLOGIN_KEY());
  const { run } = videostreamResolve(t);
  // Open before the key, then gone as its navigation starts.
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  ctx.page.goto = async () => {
    await ctx.close();
    throw closedError();
  };
  const res = await run();
  assert.equal(res.code, 200);
  // The plain session spent the key itself, saved its session, then captured.
  assert.deepEqual(plain.visited.slice(0, 2), [AUTOLOGIN_URL, VIDEOSTREAM_URL]);
  assert.deepEqual(plain.added, []);
  assert.deepEqual(loadSessionCookies(SITE), [SESSION_COOKIE]);
});

test('a window closed under the capture leaves it to the plain session with the saved session', async (t) => {
  const profile = fakeProfile(t);
  const plain = stubPlainSession(t);
  const calls = stubFetch(t, () => AUTOLOGIN_KEY());
  const { run } = videostreamResolve(t);
  saveSessionCookies(SITE, [SESSION_COOKIE]);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  ctx.newPage = async () => {
    await ctx.close();
    throw closedError();
  };
  const res = await run();
  assert.equal(res.code, 200);
  assert.equal(keyCalls(calls).length, 0);
  assert.deepEqual(plain.added, [SESSION_COOKIE]);
  assert.equal(plain.visited[0], VIDEOSTREAM_URL);
});

test('a window closed under the capture after the autologin hands the plain session its cookies', async (t) => {
  const profile = fakeProfile(t);
  const plain = stubPlainSession(t);
  const calls = stubFetch(t, () => AUTOLOGIN_KEY());
  const { run } = videostreamResolve(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  ctx.newPage = async () => {
    await ctx.close();
    throw closedError();
  };
  const res = await run();
  assert.equal(res.code, 200);
  // One key, spent in the window; the plain session captures once on the cookies it saved.
  assert.equal(keyCalls(calls).length, 1);
  assert.ok(fromPage(calls[0].init));
  assert.deepEqual(plain.added, [SESSION_COOKIE]);
  assert.deepEqual(plain.visited, [VIDEOSTREAM_URL, 'about:blank']);
});

test('a failed autologin navigation in the window throws and saves no session', async (t) => {
  const profile = fakeProfile(t);
  const plain = stubPlainSession(t);
  const calls = stubFetch(t, () => AUTOLOGIN_KEY());
  const { run } = videostreamResolve(t);
  await gated(() => openChallenge(SITE));
  const [ctx] = profile.launches;
  const goto = ctx.page.goto;
  ctx.page.goto = async () => {
    throw new Error('page.goto: Timeout 30000ms exceeded');
  };
  const err = await run().then(
    () => null,
    (e) => e,
  );
  assert.match(String(err?.message), /Timeout/);
  assert.equal(ctx.capturePages.length, 0);
  assert.equal(plain.opened, false);
  assert.equal(loadSessionCookies(SITE), null);
  // Nothing was saved, so the next capture asks for a key again.
  ctx.page.goto = goto;
  assert.equal((await run()).code, 200);
  assert.equal(keyCalls(calls).length, 2);
});

test('a Moodle browser on the captcha answers 503 captcha and spends no autologin key', async (t) => {
  fakeProfile(t, { lands: 'captcha' });
  const plain = stubPlainSession(t);
  const calls = stubFetch(t, () => json({ key: 'k', autologinurl: `${SITE}/a`, warnings: [] }));
  const { run } = videostreamResolve(t);
  const res = await run();
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'site_blocked');
  assert.equal(res.body.params.challengeWindow, 'captcha');
  assert.equal(calls.length, 0);
  assert.equal(plain.opened, false);
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
