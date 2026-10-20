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
  getVideostreamContent,
  getPublicConfig,
  openPluginfile,
  openMoodleFile,
  WsBlockedError,
} from '../src/moodle/wsClient.js';

const SITE = 'https://moodle.test';
const tick = () => new Promise((r) => setImmediate(r));
// The window's timers are unref'd (a live server keeps the process up); this stands in for it.
function keepAlive(t) {
  const keep = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keep));
}
// The window's state without the process-wide solve count, which earlier tests have moved.
const shown = () => {
  const { open, captcha } = challengeState();
  return { open, captcha };
};

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
  assert.deepEqual(shown(), { open: true, captcha: false });
  assert.equal(moodleGate.busy(), false);
});

test('landing on a captcha brings the window on screen and in front', async (t) => {
  const profile = fakeProfile(t, { lands: 'captcha' });
  const seen = [];
  const onChange = () => seen.push(shown());
  challengeEvents.on('change', onChange);
  t.after(() => challengeEvents.off('change', onChange));
  assert.equal(await moodleGate.run({}, () => openChallenge(SITE)), 'captcha');
  const [ctx] = profile.launches;
  assert.deepEqual(ctx.bounds, [{ left: 80, top: 80 }]);
  assert.equal(ctx.fronted, 1);
  assert.deepEqual(shown(), { open: true, captcha: true });
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
  assert.deepEqual(shown(), { open: false, captcha: false });
});

test('an unknown browser UA launches no window: a clearance under a non-app UA is no use', async (t) => {
  const profile = fakeProfile(t);
  t.after(configureChallenge({ userAgent: async () => null }));
  assert.equal(await gated(() => openChallenge(SITE)), false);
  assert.equal(profile.launches.length, 0);
  assert.deepEqual(shown(), { open: false, captcha: false });
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
    body: new URLSearchParams({ component: 'mod_videostream' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  await res.body?.cancel();
  const { init } = calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.body, 'component=mod_videostream');
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

test('a call while the page is on the captcha sends nothing until the solve, then goes out', async (t) => {
  const profile = fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  const calls = stubFetch(t, () => json([{ id: 5 }]));
  const call = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '5'));
  await tick();
  assert.equal(calls.length, 0);
  profile.launches[0].solve(SITE);
  assert.deepEqual(await call, [{ id: 5 }]);
  assert.equal(calls.length, 1);
  assert.ok(fromPage(calls[0].init));
});

test('the pre-login check on a captcha is refused unsent: it never waits', async (t) => {
  fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  const calls = stubFetch(t, () => json({}));
  const err = await moodleGate.run({}, () => getPublicConfig(SITE)).catch((e) => e);
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

test('a captcha holds the lock for the user: a press is admitted and waits, a queued call waits for it', async (t) => {
  const profile = fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  const [ctx] = profile.launches;
  // The frontend may press: moodleBusy reads false while only the captcha holds the lock.
  assert.equal(moodleGate.busy(), false);
  const calls = stubFetch(t, () => json([]));

  const order = [];
  const queued = moodleGate.run({ wait: true }, async () => {
    await getCourseContents(SITE, 'tok', '1');
    order.push('queued');
  });
  await tick();
  assert.deepEqual(order, []);

  // Unsolved, the press is admitted but sends nothing until the solve.
  const press = moodleGate.run({}, async () => {
    await getCourseContents(SITE, 'tok', '1');
    order.push('press');
  });
  await tick();
  assert.equal(calls.length, 0);

  // Solved: the page landing back on the site lets the lock go and moves the window off-screen;
  // the press goes out through the window, then the queued call runs.
  ctx.solve(SITE);
  await Promise.all([press, queued]);
  assert.deepEqual(order, ['press', 'queued']);
  assert.deepEqual(ctx.bounds.at(-1), { left: -32000, top: -32000 });
  assert.deepEqual(shown(), { open: true, captcha: false });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ init }) => fromPage(init)));
});

test('a captcha opened by no waiting call (the probe) keeps admitting a press', async (t) => {
  fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  assert.equal(moodleGate.busy(), false);
  await moodleGate.run({}, () => moodleGate.enter('x'));
  assert.equal(moodleGate.busy(), false);
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
  assert.deepEqual(shown(), { open: true, captcha: true });
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
  assert.deepEqual(shown(), { open: false, captcha: false });
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
  assert.deepEqual(shown(), { open: false, captcha: false });
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
  assert.deepEqual(shown(), { open: false, captcha: false });
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

test('a blocked /list opens the window on the captcha and answers 200 once the user solves it', async (t) => {
  setCurrentSite(SITE);
  t.after(() => setCurrentSite(null));
  writeTokenFile(statePath('auth', 'moodle-token.json'), { site: SITE, wstoken: 'w', userid: 7 });
  const profile = fakeProfile(t, { lands: 'captcha' });
  stubFetch(t, (url, init) => (fromPage(init) ? json([]) : html()));
  const res = fakeRes();
  const listed = handleList({ body: { courseUrl: `${SITE}/course/view.php?id=5` } }, res);
  await until(() => challengeState().captcha);
  assert.equal(res.code, null);
  assert.equal(profile.launches[0].page.url(), CAPTCHA_URL);
  profile.launches[0].solve(SITE);
  await listed;
  assert.equal(res.code, 200);
  assert.deepEqual(shown(), { open: true, captcha: false });
});

test('a captcha left unsolved for captchaMs answers 503 site_captcha_timeout with no status', async (t) => {
  keepAlive(t);
  setCurrentSite(SITE);
  t.after(() => setCurrentSite(null));
  writeTokenFile(statePath('auth', 'moodle-token.json'), { site: SITE, wstoken: 'w', userid: 7 });
  const profile = fakeProfile(t, { lands: 'captcha', captchaMs: 30 });
  stubFetch(t, () => html());
  const res = fakeRes();
  await handleList({ body: { courseUrl: `${SITE}/course/view.php?id=5` } }, res);
  assert.equal(res.code, 503);
  assert.deepEqual(
    [res.body.code, res.body.params, res.body.status],
    ['site_captcha_timeout', {}, undefined],
  );
  assert.equal(profile.launches[0].closed, true);
  assert.deepEqual(shown(), { open: false, captcha: false });
});

test('a block on an unrouted path opens no window and carries no challengeWindow', async (t) => {
  const profile = fakeProfile(t);
  stubFetch(t, () => html());
  const err = await gated(() => openMoodleFile(`${SITE}/v.mp4`, { headers: [] })).catch((e) => e);
  assert.ok(err instanceof WsBlockedError);
  await gated(() => reportBlock(err, SITE));
  assert.equal('challengeWindow' in err.params, false);
  assert.equal(profile.launches.length, 0);
  assert.deepEqual(shown(), { open: false, captcha: false });
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
  assert.deepEqual(shown(), { open: true, captcha: false });
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

const CONTENT = {
  templates: [],
  javascript: '',
  otherdata: [],
  files: [],
  restrict: [],
  disabled: false,
};
const VIDEOSTREAM_ARGS = { courseid: '108106', cmid: '3047355', userid: 7 };

test('the videostream content call goes out from the window while it is open, as a form POST', async (t) => {
  onSite(t);
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const calls = stubFetch(t, () => json(CONTENT));
  assert.deepEqual(
    await gated(() => getVideostreamContent(SITE, 'tok', VIDEOSTREAM_ARGS)),
    CONTENT,
  );
  assert.equal(calls.length, 1);
  assert.ok(fromPage(calls[0].init));
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(new URLSearchParams(calls[0].init.body).get('method'), 'view_videostream');
});

test('a walled videostream content call reopens the window hidden and is resent through it', async (t) => {
  onSite(t);
  const profile = fakeProfile(t);
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? json(CONTENT) : html()));
  assert.deepEqual(
    await gated(() => getVideostreamContent(SITE, 'tok', VIDEOSTREAM_ARGS)),
    CONTENT,
  );
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

// ── A captcha met by a routed call waits for the user's solve ──────────────

// Resolves once `cond()` holds, checking each macrotask.
async function until(cond) {
  while (!cond()) await tick();
}

test('a walled Node call that lands on a captcha waits for the solve, then is resent through the window', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? json([{ id: 1 }]) : html()));
  const call = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1'));
  await until(() => challengeState().captcha);
  assert.equal(calls.length, 1);
  profile.launches[0].solve(SITE);
  assert.deepEqual(await call, [{ id: 1 }]);
  assert.equal(calls.length, 2);
  assert.ok(fromPage(calls[1].init));
  assert.deepEqual(profile.launches[0].visited, [SITE]);
});

test('a second call during the captcha waits on the same solve, then sends', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? json([]) : html()));
  const first = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1'));
  await until(() => challengeState().captcha);
  // A server/ call queued behind the first, and nothing else sent meanwhile.
  const second = moodleGate.run({ wait: true }, () => getCourseContents(SITE, 'tok', '2'));
  await tick();
  assert.equal(calls.length, 1);
  profile.launches[0].solve(SITE);
  await Promise.all([first, second]);
  assert.deepEqual(
    calls.map(({ init }) => fromPage(init)),
    [false, true, true],
  );
});

test('the solved browser walled again waits once more, then throws site_blocked', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  const calls = stubFetch(t, () => html());
  const err = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  await until(() => challengeState().captcha);
  profile.launches[0].solve(SITE);
  // The resend is walled: the root reloads onto the captcha, and the call waits again.
  await until(() => challengeState().captcha);
  profile.launches[0].solve(SITE);
  const thrown = await err;
  assert.ok(thrown instanceof WsBlockedError);
  assert.equal(thrown.code, 'site_blocked');
  // Node, the resend after each of the two solves: no third wait, no third resend.
  assert.equal(calls.length, 3);
  assert.equal(challengeState().solved >= 2, true);
});

test('a call starting on a captcha already up waits twice at most, counted with the reopens', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  const calls = stubFetch(t, () => html());
  const [ctx] = profile.launches;
  const err = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  await tick();
  ctx.solve(SITE); // the first wait, before the call is sent at all
  await until(() => calls.length === 1 && challengeState().captcha);
  ctx.solve(SITE); // the one wait beyond it
  const thrown = await err;
  assert.equal(thrown.code, 'site_blocked');
  // The window reloaded onto the captcha a third time; the call reports it rather than waiting.
  assert.equal(thrown.params.challengeWindow, 'captcha');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ init }) => fromPage(init)));
});

test('the user closing the window mid-wait answers site_blocked with no challengeWindow', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  stubFetch(t, () => html());
  const err = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  await until(() => challengeState().captcha);
  await profile.launches[0].close();
  const thrown = await err;
  assert.ok(thrown instanceof WsBlockedError);
  assert.equal(thrown.routed, false);
  await gated(() => reportBlock(thrown, SITE));
  assert.equal('challengeWindow' in thrown.params, false);
});

test('a caller hanging up stops its wait alone; the other waiter still gets the solve', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  const calls = stubFetch(t, (url, init) => (fromPage(init) ? json([]) : html()));
  const ac = new AbortController();
  const gone = moodleGate
    .run({ signal: ac.signal }, () => getCourseContents(SITE, 'tok', '1'))
    .catch((e) => e);
  await until(() => challengeState().captcha);
  // A press admitted on the probe-like hold would be refused: the hung-up caller still waits here.
  const other = moodleGate.run({ wait: true }, () => getCourseContents(SITE, 'tok', '2'));
  ac.abort(new Error('hung up'));
  assert.equal((await gone).message, 'hung up');
  assert.equal(shown().captcha, true);
  profile.launches[0].solve(SITE);
  await other;
  assert.equal(calls.filter(({ init }) => fromPage(init)).length, 1);
});

test("a file stream's own signal ends its wait when the reader hangs up", async (t) => {
  onSite(t);
  fakeProfile(t, { lands: 'captcha' });
  const calls = stubFetch(t, () => html());
  const ac = new AbortController();
  const err = moodleGate
    .run({}, () => openPluginfile(`${SITE}/pluginfile.php/1/a.pdf?token=t`, { signal: ac.signal }))
    .catch((e) => e);
  await until(() => challengeState().captcha);
  ac.abort(new Error('reader gone'));
  assert.equal((await err).message, 'reader gone');
  assert.equal(calls.length, 1);
});

test('the captcha unsolved for captchaMs ends every waiter with site_captcha_timeout', async (t) => {
  keepAlive(t);
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha', captchaMs: 30 });
  stubFetch(t, () => html());
  const err = await moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.equal(err.code, 'site_captcha_timeout');
  assert.deepEqual(err.params, {});
  assert.equal(err.message, "the captcha in the site's challenge window was not solved in time");
  assert.equal(profile.launches[0].closed, true);
});

test('no browser for the window still throws site_blocked with challengeWindow false', async (t) => {
  onSite(t);
  t.after(configureChallenge({ userAgent: async () => null }));
  stubFetch(t, () => html());
  const err = await gated(() => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.equal(err.code, 'site_blocked');
  assert.equal(err.params.challengeWindow, false);
});

// ── What /auth/events reads while a call waits ──────────────────────────────

// Every frame /auth/events would send, as it composes them.
function frames(t) {
  const seen = [];
  const push = () => seen.push({ moodleBusy: moodleGate.busy(), ...challengeState() });
  moodleGate.on('change', push);
  challengeEvents.on('change', push);
  t.after(() => {
    moodleGate.off('change', push);
    challengeEvents.off('change', push);
  });
  return seen;
}

test('a call waiting on the captcha reads busy, and only in frames that show the captcha', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  stubFetch(t, (url, init) => (fromPage(init) ? json([]) : html()));
  const seen = frames(t);
  const solvedBefore = challengeState().solved;
  const call = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1'));
  await until(() => challengeState().captcha);
  await tick();
  // Waiting: busy, so the admitting hold lets no press on top.
  assert.equal(moodleGate.busy(), true);
  const press = await moodleGate.run({}, () => moodleGate.enter('x')).catch((e) => e);
  assert.equal(press.code, 'moodle_busy');
  // Nothing read "not busy" while the captcha was up and the call waited on it.
  assert.equal(
    seen.some((f) => f.captcha && !f.moodleBusy),
    false,
  );
  profile.launches[0].solve(SITE);
  await call;
  // The solve: one more solved, in the frame that clears the captcha.
  const cleared = seen.find((f) => f.open && !f.captcha && f.solved === solvedBefore + 1);
  assert.ok(cleared);
  assert.equal(
    seen.some((f) => f.solved > solvedBefore + 1),
    false,
  );
});

test('a press admitted on a probe-opened captcha that waits turns busy in a frame with the captcha', async (t) => {
  onSite(t);
  const profile = fakeProfile(t, { lands: 'captcha' });
  await moodleGate.run({}, () => openChallenge(SITE));
  stubFetch(t, () => json([]));
  const seen = frames(t);
  const solvedBefore = challengeState().solved;
  const press = moodleGate.run({}, () => getCourseContents(SITE, 'tok', '1'));
  await tick();
  assert.equal(moodleGate.busy(), true);
  assert.deepEqual(seen.at(-1), {
    moodleBusy: true,
    open: true,
    captcha: true,
    solved: solvedBefore,
  });
  profile.launches[0].solve(SITE);
  await press;
  assert.equal(challengeState().solved, solvedBefore + 1);
});

test('the waiter hanging up gives the captcha back its admitting hold', async (t) => {
  onSite(t);
  fakeProfile(t, { lands: 'captcha' });
  stubFetch(t, () => html());
  const ac = new AbortController();
  const gone = moodleGate
    .run({ signal: ac.signal }, () => getCourseContents(SITE, 'tok', '1'))
    .catch((e) => e);
  await until(() => challengeState().captcha);
  await tick();
  assert.equal(moodleGate.busy(), true);
  ac.abort(new Error('hung up'));
  await gone;
  // Its request ended; the captcha's hold remains, admitting a press again.
  assert.equal(moodleGate.busy(), false);
  assert.equal(shown().captcha, true);
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
    functions: [{ name: 'core_course_get_contents' }, { name: 'tool_mobile_get_content' }],
  };
  stubFetch(t, (url, init) => (fromPage(init) ? json(GOOD) : html()));
  const { auth } = siteAuth();
  // The caller hangs up mid-wait, leaving the token unverified behind a captcha still up.
  const ac = new AbortController();
  const err = moodleGate.run({ signal: ac.signal }, () => auth.complete()).catch((e) => e);
  await until(() => challengeState().captcha);
  ac.abort(new Error('hung up'));
  assert.equal((await err).message, 'hung up');
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
