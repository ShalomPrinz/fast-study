// A WS call's answer is only a WS answer when it is JSON: the Moodle site is fronted by bot
// protection that serves an HTML captcha page (200) or a 302 to one when it decides a client is
// automated, so those are their own failure — not a WS fault, and not a JSON parse bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPluginfileReadable,
  getCourseContents,
  blocked,
  invalidToken,
  WsError,
  WsBlockedError,
  configureWsClient,
  openPluginfile,
} from '../src/moodle/wsClient.js';
import { unreachable } from '../src/lib/errors.js';
import { openChallenge, challengeRoute } from '../src/moodle/challenge.js';
import { fakeProfile } from './fakeProfile.js';
import { gated } from './gated.js';

// Minimal Response stand-in: callWs only reads status, content-type and json().
function stubFetch(t, { status = 200, contentType = 'application/json', body = null } = {}) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = async () => ({
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => JSON.parse(body),
  });
}

const SITE = 'https://moodle.test';
const CAPTCHA_HTML = '<!DOCTYPE html><html><head><title>Radware Captcha Page</title></head></html>';

test('an HTML challenge page under HTTP 200 is blocked, not a parse error', async (t) => {
  stubFetch(t, { contentType: 'text/html; charset=utf-8', body: CAPTCHA_HTML });
  const err = await gated(() => getCourseContents(SITE, 'tok', '108980')).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.equal(blocked(err), true);
  assert.equal(invalidToken(err), false);
  assert.match(err.message, /refusing automated requests/);
  assert.match(err.message, /text\/html/);
});

test('a redirect to an HTML page is blocked', async (t) => {
  stubFetch(t, { status: 302, contentType: 'text/html' });
  const err = await gated(() => getCourseContents(SITE, 'tok', '108980')).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.match(err.message, /HTTP 302 redirect/);
});

test('a missing content-type is blocked and says so', async (t) => {
  stubFetch(t, { contentType: null, body: '{}' });
  const err = await gated(() => getCourseContents(SITE, 'tok', '108980')).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.match(err.message, /no content-type/);
});

test('a JSON answer still parses', async (t) => {
  stubFetch(t, { body: JSON.stringify([{ section: 1, modules: [] }]) });
  assert.deepEqual(await gated(() => getCourseContents(SITE, 'tok', '108980')), [
    { section: 1, modules: [] },
  ]);
});

test('a WS exception body still throws WsError, unaffected by the JSON gate', async (t) => {
  stubFetch(t, {
    body: JSON.stringify({
      exception: 'moodle_exception',
      errorcode: 'invalidtoken',
      message: 'x',
    }),
  });
  const err = await gated(() => getCourseContents(SITE, 'dead', '108980')).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsError);
  assert.equal(invalidToken(err), true);
  assert.equal(blocked(err), false);
});

// The pluginfile preflight is not a WS call — success is file bytes, not JSON — so its
// challenge check keys on an HTML answer where only application/pdf resources are ever routed.
const PDF_URL = 'https://lemida.biu.ac.il/webservice/pluginfile.php/1/mod_resource/1/x.pdf?token=t';

test('a challenge page on the pluginfile preflight raises instead of passing HTML through', async (t) => {
  stubFetch(t, { status: 200, contentType: 'text/html; charset=utf-8', body: CAPTCHA_HTML });
  const err = await gated(() => assertPluginfileReadable(PDF_URL)).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.equal(blocked(err), true);
  assert.match(err.message, /pluginfile/);
});

test('a redirect on the pluginfile preflight raises', async (t) => {
  stubFetch(t, { status: 302, contentType: 'text/html' });
  const err = await gated(() => assertPluginfileReadable(PDF_URL)).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsBlockedError);
  assert.match(err.message, /HTTP 302 redirect/);
});

test('a real file answer on the pluginfile preflight passes', async (t) => {
  stubFetch(t, { status: 206, contentType: 'application/pdf' });
  await gated(() => assertPluginfileReadable(PDF_URL)); // resolves; no throw
});

test('a dead token on the pluginfile preflight still raises WsError, not blocked', async (t) => {
  stubFetch(t, {
    contentType: 'application/json',
    body: JSON.stringify({ errorcode: 'invalidtoken', message: 'Invalid token' }),
  });
  const err = await gated(() => assertPluginfileReadable(PDF_URL)).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsError);
  assert.equal(invalidToken(err), true);
  assert.equal(blocked(err), false);
});

// A WsError is logged with its errorcode, debuginfo and route; Sentry sees only the message, so the
// errorcode rides there too. debuginfo can echo the wstoken verbatim, so it is blanked.
test('a WS fault logs errorcode, redacted debuginfo and route, and names the errorcode', async (t) => {
  const TOK = 'w'.repeat(32);
  stubFetch(t, {
    body: JSON.stringify({
      exception: 'invalid_parameter_exception',
      errorcode: 'invalidparameter',
      message: 'ערך פרמטר לא חוקי',
      debuginfo: `courseid => the value is "x" (wstoken ${TOK})`,
    }),
  });
  const warn = t.mock.method(console, 'warn', () => {});
  const err = await gated(() => getCourseContents(SITE, TOK, 'x')).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof WsError);
  assert.equal(err.params.errorcode, 'invalidparameter');
  assert.match(err.message, /\(invalidparameter\)$/);
  const line = warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(line, /core_course_get_contents: invalidparameter via node/);
  assert.match(line, /debuginfo: courseid => the value is "x" \(wstoken <redacted>\)/);
  assert.equal(line.includes(TOK), false);
});

test('a WS fault without debuginfo logs no debuginfo', async (t) => {
  stubFetch(t, {
    body: JSON.stringify({ exception: 'x', errorcode: 'invalidtoken', message: 'bad' }),
  });
  const warn = t.mock.method(console, 'warn', () => {});
  await gated(() => getCourseContents(SITE, 'tok', '1')).catch(() => {});
  const [line] = warn.mock.calls[0].arguments;
  assert.equal(line, 'moodle core_course_get_contents: invalidtoken via node');
});

// Head timeout (docs/MOODLE.md § Time limits): shortened so no test waits 60s.
const hangs = (_url, init) =>
  new Promise((_, reject) =>
    init.signal?.addEventListener('abort', () => reject(init.signal.reason)),
  );

test('a Node fetch with no response head rejects as site_unreachable and frees the lock', async (t) => {
  t.after(configureWsClient({ headMs: 20 }));
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = hangs;
  const err = await gated(() => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.equal(unreachable(err)?.code, 'site_unreachable');
  assert.equal(unreachable(err).params.host, 'moodle.test');
  await gated(async () => {}); // the gate is takeable again
});

function stubGlobalFetch(t, fn) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = fn;
}

test('a window call with no head rejects as site_unreachable and drops busy', async (t) => {
  t.after(configureWsClient({ headMs: 20 }));
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  stubGlobalFetch(t, hangs);
  const win = challengeRoute(SITE);
  const err = await gated(() => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.equal(unreachable(err)?.code, 'site_unreachable');
  assert.equal(unreachable(err).params.host, 'moodle.test');
  assert.equal(win.busy, 0);
  assert.equal(profile.launches[0].closed, false);
});

test('a window body slower than the head timeout after a prompt head is not cut', async (t) => {
  t.after(configureWsClient({ headMs: 20 }));
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  stubGlobalFetch(t, async (_url, init) => {
    const res = new Response(
      new ReadableStream({
        async start(ctl) {
          await new Promise((r) => setTimeout(r, 100)); // five head timeouts
          if (init.signal?.aborted) return ctl.error(init.signal.reason);
          ctl.enqueue(new TextEncoder().encode('lecture'));
          ctl.close();
        },
      }),
      { headers: { 'content-type': 'video/mp4' } },
    );
    return res;
  });
  const res = await gated(() => openPluginfile(`${SITE}/pluginfile.php/1/mod/f/1/a.mp4?token=t`));
  assert.equal(await res.text(), 'lecture');
  assert.equal(challengeRoute(SITE).busy, 0);
});

test('an abandoned window call whose page call finishes late has its stored body dropped', async (t) => {
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  const page = profile.launches[0].page;
  const dropped = [];
  let finish;
  page.evaluate = (fn, arg) => {
    if (fn.name === 'pageDrop') return Promise.resolve(dropped.push(arg));
    return new Promise((r) => (finish = r));
  };
  const win = challengeRoute(SITE);
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(new DOMException('gone', 'TimeoutError')), 5);
  const err = await win.fetch(`${SITE}/x`, { signal: ctl.signal }).catch((e) => e);
  assert.equal(err.name, 'TimeoutError');
  finish({ status: 200, headers: [], id: 'late', size: 5 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(dropped, ['late']);
  assert.equal(win.busy, 0);
});

test('an attempt removes its listener from the caller signal', async (t) => {
  const listeners = new Set();
  const signal = Object.assign(new EventTarget(), { aborted: false, reason: undefined });
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, fn, o) => (listeners.add(fn), add(type, fn, o));
  signal.removeEventListener = (type, fn, o) => (listeners.delete(fn), remove(type, fn, o));
  stubGlobalFetch(t, async () => new Response('x', { headers: { 'content-type': 'video/mp4' } }));
  for (let i = 0; i < 3; i++) {
    const res = await gated(() =>
      openPluginfile(`${SITE}/pluginfile.php/1/mod/f/1/a.mp4?token=t`, { signal }),
    );
    await res.text();
  }
  assert.equal(listeners.size, 0);
});

test('a captcha wait longer than the head timeout is not cut by it', async (t) => {
  t.after(configureWsClient({ headMs: 20 }));
  const profile = fakeProfile(t, { lands: 'captcha', captchaMs: 10_000 });
  await gated(() => openChallenge(SITE));
  const ctx = profile.launches[0];
  ctx.page.evaluate = async (fn) =>
    fn.name === 'pageFetch'
      ? { status: 200, headers: [['content-type', 'application/json']], id: 'b', size: 2 }
      : Buffer.from('[]').toString('base64');
  const call = gated(() => getCourseContents(SITE, 'tok', '1'));
  await new Promise((r) => setTimeout(r, 100)); // five head timeouts
  ctx.solve(SITE);
  assert.deepEqual(await call, []);
});

test('a body read after the head is not cut by the head timeout', async (t) => {
  t.after(configureWsClient({ headMs: 20 }));
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = async (_url, init) => {
    const body = new ReadableStream({
      async start(ctl) {
        await new Promise((r) => setTimeout(r, 80));
        if (init.signal?.aborted) return ctl.error(init.signal.reason);
        ctl.enqueue(new TextEncoder().encode('lecture'));
        ctl.close();
      },
    });
    return new Response(body, { headers: { 'content-type': 'video/mp4' } });
  };
  const res = await gated(() => openPluginfile(`${SITE}/pluginfile.php/1/mod/f/1/a.mp4?token=t`));
  assert.equal(await res.text(), 'lecture');
});

// Window-route stall and hung-renderer bounds (docs/MOODLE.md § Time limits).
const PLUGIN = `${SITE}/pluginfile.php/1/mod/f/1/a.mp4?token=t`;

// A body that sends one chunk per gap, `n` times, then ends; errors with the signal's reason if aborted.
const trickle = (gap, n) => async (_url, init) =>
  new Response(
    new ReadableStream({
      async start(ctl) {
        for (let i = 0; i < n; i++) {
          await new Promise((r) => setTimeout(r, gap));
          if (init.signal?.aborted) return ctl.error(init.signal.reason);
          ctl.enqueue(new TextEncoder().encode('x'));
        }
        ctl.close();
      },
    }),
    { headers: { 'content-type': 'video/mp4' } },
  );

test('a window body that stalls after the head rejects as site_unreachable and drops busy', async (t) => {
  t.after(configureWsClient({ headMs: 1000, stallMs: 30 }));
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  stubGlobalFetch(t, trickle(500, 1));
  const win = challengeRoute(SITE);
  const err = await gated(() => openPluginfile(PLUGIN)).catch((e) => e);
  assert.equal(unreachable(err)?.code, 'site_unreachable');
  assert.equal(unreachable(err).params.host, 'moodle.test');
  assert.equal(win.busy, 0);
});

test('a window body trickling slower than the stall window in total is not cut', async (t) => {
  t.after(configureWsClient({ headMs: 1000, stallMs: 60 }));
  fakeProfile(t);
  await gated(() => openChallenge(SITE));
  stubGlobalFetch(t, trickle(20, 8)); // 160 ms total, 20 ms gaps
  const res = await gated(() => openPluginfile(PLUGIN));
  assert.equal(await res.text(), 'xxxxxxxx');
  assert.equal(challengeRoute(SITE).busy, 0);
});

test('a WS call whose page never answers rejects via the backstop and drops busy', async (t) => {
  t.after(configureWsClient({ headMs: 20, stallMs: 20 }));
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  profile.launches[0].page.evaluate = () => new Promise(() => {});
  const win = challengeRoute(SITE);
  const err = await gated(() => getCourseContents(SITE, 'tok', '1')).catch((e) => e);
  assert.equal(unreachable(err)?.code, 'site_unreachable');
  assert.equal(unreachable(err).params.host, 'moodle.test');
  assert.equal(win.busy, 0);
});

test('a file open is not under the backstop', async (t) => {
  t.after(configureWsClient({ headMs: 20, stallMs: 20 }));
  const profile = fakeProfile(t);
  await gated(() => openChallenge(SITE));
  let finish;
  profile.launches[0].page.evaluate = () => new Promise((r) => (finish = r));
  const open = gated(() => openPluginfile(PLUGIN));
  let settled = false;
  open.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((r) => setTimeout(r, 120)); // three backstop windows
  assert.equal(settled, false);
  finish({ status: 200, headers: [['content-type', 'video/mp4']], id: null, size: 0 });
  assert.equal((await open).status, 200);
});
