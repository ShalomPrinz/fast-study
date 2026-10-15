// Block mode: while the site's bot manager blocks us, one headed Chrome on a persistent profile is
// open on the site, and moodleFetch sends Moodle calls through its page — the only client whose
// clearance the bot manager honours. Closing it ends block mode. See docs/MOODLE.md § Bot protection.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { statePath } from '@faststudy/runtime';
import { launchPersistentBrowser } from '../browser/browserLaunch.js';
import { resolveUserAgent } from '../browser/browserChannel.js';
import { moodleGate, enterMoodle } from './gate.js';

// Chrome clamps it to about -13107, still far off-screen; the flag beats the profile's saved position.
const OFF_SCREEN = { left: -32000, top: -32000 };
const ON_SCREEN = { left: 80, top: 80 };
const LAUNCH_ARGS = [`--window-position=${OFF_SCREEN.left},${OFF_SCREEN.top}`];
// A body crosses from the page in slices this size, base64-encoded.
const CHUNK = 4 * 1024 * 1024;
const NULL_BODY = new Set([101, 204, 205, 304]);

// Moodle answers app-only calls to a UA containing it (is_moodle_app()); see docs/MOODLE.md § Bot protection.
const MOODLE_APP_UA = ' MoodleMobile';

// Closed after idleMs with no call through it; a captcha on screen gets captchaMs for the user's solve.
// userAgent: the installed channel's real UA, or null when unknown.
const deps = {
  launch: launchPersistentBrowser,
  userAgent: resolveUserAgent,
  idleMs: 60_000,
  captchaMs: 10 * 60_000,
};
let win = null;
let opening = null;
let closing = Promise.resolve();

/**
 * 'change' whenever `challengeState()` may have changed (/auth/events subscribes); 'solved' (site)
 * when the page lands back on the site after a captcha (the registry verifies an unverified token).
 */
export const challengeEvents = new EventEmitter();
const publish = () => challengeEvents.emit('change');

/** Tests swap the launcher and the idle timeouts; → a function restoring the previous ones. */
export function configureChallenge(overrides) {
  const prev = { ...deps };
  Object.assign(deps, overrides);
  return () => Object.assign(deps, prev);
}

/** Where the window's profile — and with it the bot manager's clearance — lives. */
export const profileDir = () => statePath('moodle-profile');

/** `{ open, captcha }`: a window is up; it is on screen waiting for the user to solve a captcha. */
export function challengeState() {
  return { open: win !== null, captcha: win?.captcha === true };
}

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** The open window when `url` is on its site — the route moodleFetch takes — else null. */
export function challengeRoute(url) {
  return win && originOf(String(url)) === win.origin ? win : null;
}

// Runs in the page; Node pulls the kept body in slices. Sent through a hidden about:blank iframe's
// native fetch, since the site's scripts replace the page's (docs/MOODLE.md § Bot protection).
async function pageFetch({ url, method, headers, body }) {
  let frame = document.getElementById('__fastStudyFetch');
  if (!frame?.contentWindow) {
    frame = document.createElement('iframe');
    frame.id = '__fastStudyFetch';
    frame.src = 'about:blank';
    frame.style.display = 'none';
    document.documentElement.appendChild(frame);
  }
  const r = await frame.contentWindow.fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    credentials: 'include',
    cache: 'no-store',
  });
  if (r.type === 'opaqueredirect') return { status: 302, headers: [], id: null, size: 0 };
  const buf = new Uint8Array(await r.arrayBuffer());
  const id = `${Date.now()}-${Math.random()}`;
  (globalThis.__fastStudyBodies ??= new Map()).set(id, buf);
  return { status: r.status, headers: [...r.headers], id, size: buf.length };
}

// Runs in the page: one base64 slice of a kept body, dropping it after the last one.
function pageChunk({ id, offset, length }) {
  const bodies = globalThis.__fastStudyBodies;
  const buf = bodies?.get(id);
  if (!buf) return null;
  const part = buf.subarray(offset, offset + length);
  if (offset + length >= buf.length) bodies.delete(id);
  let s = '';
  for (let i = 0; i < part.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function pageDrop(id) {
  globalThis.__fastStudyBodies?.delete(id);
}

// A page fetch cannot set User-Agent (Chrome drops it), and the clearance is tied to the UA the
// window launched with, so the context's MoodleMobile UA is the one every call carries.
function pageHeaders(init) {
  const headers = new Headers(init);
  headers.delete('user-agent');
  return [...headers];
}

function pageBody(body) {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new TypeError('the challenge window only sends string or form bodies');
}

function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    ),
  ]);
}

class ChallengeWindow {
  constructor(site, context, page) {
    this.site = site;
    this.origin = originOf(site);
    this.context = context;
    this.page = page;
    // On screen holding the Moodle lock (docs/GATE.md), from landing on a captcha to the first
    // call through the window that passes.
    this.captcha = false;
    this.lease = null;
    this.timer = null;
    // Page calls in flight: the idle close waits for them, since closing would cut them off.
    this.busy = 0;
    // Bodies a reader has not finished or cancelled: they stretch the idle close to captchaMs.
    this.bodies = 0;
    this.ended = false;
    this.closed = new Promise((resolve) => context.once('close', resolve));
    this.closed.then(() => this._ended());
    // The user solving the captcha lands the page back on the site: the lock is theirs no longer,
    // even if their retry never reaches Moodle (a replay-cache hit).
    page.on?.('framenavigated', () => {
      if (!this.captcha || !this.onSite()) return;
      void this.passed();
      challengeEvents.emit('solved', this.site);
    });
  }

  /** The window went away under a call: the user closed it, which ends block mode. */
  gone(err) {
    return this.ended || win !== this || err?.name === 'TargetClosedError';
  }

  /** The page is on the site, so the clearance holds; anywhere else it is on the captcha. */
  onSite() {
    return originOf(this.page.url()) === this.origin;
  }

  /**
   * `url` fetched by the page, as a Node Response: redirects unfollowed, the window's launch UA. A body
   * slice the page can no longer hand over (closed, or navigated away) errors the body with `lost()`.
   */
  async fetch(
    url,
    init = {},
    { lost = () => new Error('the challenge window lost the body') } = {},
  ) {
    const head = await this._evaluate(
      pageFetch,
      {
        url: String(url),
        method: init.method ?? 'GET',
        headers: pageHeaders(init.headers),
        body: pageBody(init.body),
      },
      init.signal,
    );
    const headers = new Headers();
    for (const [name, value] of head.headers) {
      // The page hands over a decoded body, so the wire's encoding and length no longer apply.
      if (name !== 'content-encoding' && name !== 'content-length') headers.append(name, value);
    }
    if (NULL_BODY.has(head.status)) return new Response(null, { status: head.status, headers });
    headers.set('content-length', String(head.size));
    return new Response(this._body(head, init.signal, lost), { status: head.status, headers });
  }

  // One page call, counted as activity from start to end so the idle close never cuts it off.
  async _evaluate(fn, arg, signal) {
    this.busy++;
    this.touch();
    try {
      return await abortable(this.page.evaluate(fn, arg), signal);
    } finally {
      this.busy--;
      this.touch();
    }
  }

  _body({ id, size }, signal, lost) {
    if (!id || size === 0) {
      if (id) this.page.evaluate(pageDrop, id).catch(() => {});
      return '';
    }
    let offset = 0;
    let open = true;
    const done = () => {
      if (!open) return;
      open = false;
      this.bodies--;
      this.touch();
    };
    this.bodies++;
    this.touch();
    return new ReadableStream({
      pull: async (ctl) => {
        try {
          signal?.throwIfAborted();
          const b64 = await this._evaluate(pageChunk, { id, offset, length: CHUNK }).catch(
            () => null,
          );
          if (b64 == null) throw lost();
          const bytes = Buffer.from(b64, 'base64');
          offset += bytes.length;
          ctl.enqueue(new Uint8Array(bytes));
          if (offset >= size) {
            ctl.close();
            done();
          }
        } catch (err) {
          done();
          throw err;
        }
      },
      cancel: () => {
        done();
        return this.page.evaluate(pageDrop, id).catch(() => {});
      },
    });
  }

  /** A call through the window passed: the captcha is behind us, so off-screen and lock free. */
  async passed() {
    if (!this.captcha) return;
    this.captcha = false;
    this._release();
    this.touch();
    publish();
    await this._bounds(OFF_SCREEN);
  }

  // Load the site root (under the caller's Moodle lock) and show the window only on a captcha.
  async land() {
    await enterMoodle(this.site);
    await this.page.goto(this.site, { waitUntil: 'load' }).catch(() => {});
    return this.settle();
  }

  /** → 'ready' when on the site, else 'captcha': on screen, in front, holding the Moodle lock. */
  async settle() {
    this.touch();
    if (this.onSite()) {
      if (this.captcha) await this.passed();
      return 'ready';
    }
    if (!this.lease) this.lease = await moodleGate.hold('challenge window', { admit: true });
    this.captcha = true;
    this.touch();
    publish();
    await this._bounds(ON_SCREEN);
    await this.page.bringToFront().catch(() => {});
    return 'captcha';
  }

  // Block mode ends once the window sits idle: no call through it for idleMs, or captchaMs while a
  // captcha waits or a body is half-read (bounding one never read). A running page call defers it.
  touch() {
    clearTimeout(this.timer);
    if (this.ended) return;
    this.timer = setTimeout(
      () => {
        if (win !== this) return;
        if (this.busy > 0) return this.touch();
        void closeChallenge();
      },
      this.captcha || this.bodies > 0 ? deps.captchaMs : deps.idleMs,
    );
    this.timer.unref?.();
  }

  _release() {
    this.lease?.release();
    this.lease = null;
  }

  _ended() {
    this.ended = true;
    clearTimeout(this.timer);
    this._release();
    if (win === this) win = null;
    publish();
  }

  /** Back on screen and in front; a minimize and restore gets past Windows' foreground lock. */
  async raise() {
    await this._bounds(ON_SCREEN, { windowState: 'minimized' }, { windowState: 'normal' });
    await this.page.bringToFront().catch(() => {});
    // Solved mid-raise: passed()'s move off-screen may have landed before ours, so park it again.
    if (!this.captcha) await this._bounds(OFF_SCREEN);
  }

  // Window state through CDP, each of `steps` in turn from a normal window (a minimized one takes no
  // position); cosmetic, so a failure never fails the call.
  async _bounds(...steps) {
    try {
      const cdp = await this.context.newCDPSession(this.page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      for (const bounds of steps) await cdp.send('Browser.setWindowBounds', { windowId, bounds });
      await cdp.detach().catch(() => {});
    } catch {
      // the window may already be gone
    }
  }
}

/**
 * Turn block mode on for `site` (or report on the window already up), under the caller's Moodle
 * lock. → 'captcha' (on screen for the user to solve), 'ready' (hidden: the profile's clearance
 * still holds, so repeating the action passes) or false (no browser could launch).
 * @returns {Promise<'captcha'|'ready'|false>}
 */
export async function openChallenge(site) {
  while (opening) await opening;
  const run = openOnce(site);
  opening = run.then(
    () => {},
    () => {},
  );
  try {
    return await run;
  } finally {
    opening = null;
  }
}

async function openOnce(site) {
  if (win && win.origin !== originOf(site)) await closeWindow();
  // Already up: a block through it means the browser itself was challenged, so reload the root.
  if (win) return win.onSite() ? win.land() : win.settle();
  // Chrome locks a profile while it runs, so a relaunch waits for the last window to be gone.
  await closing;
  let context;
  try {
    // The UA is fixed at launch: Radware ties the clearance to it, and switching it later is walled.
    // Unknown (no installed channel, or its probe could not read one) → no window, rather than a
    // clearance earned under a UA Moodle's app-only calls refuse.
    const ua = await deps.userAgent().catch(() => null);
    if (!ua) return false;
    context = await deps.launch(profileDir(), {
      headless: false,
      viewport: null,
      args: LAUNCH_ARGS,
      userAgent: ua + MOODLE_APP_UA,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    const w = new ChallengeWindow(site, context, page);
    win = w;
    closing = w.closed;
    publish();
    return await w.land();
  } catch {
    await context?.close().catch(() => {});
    return false;
  }
}

/**
 * Add `challengeWindow` to a routed call's `site_blocked` params, opening the window if it is not up.
 * A block on a path the window cannot carry (`err.routed` false) opens nothing and gets no param.
 * Idempotent, so every route can call it on whatever reaches its 503.
 */
export async function reportBlock(err, site) {
  if (!err.routed) return;
  if (err.params && 'challengeWindow' in err.params) return;
  err.params = { ...err.params, challengeWindow: site ? await openChallenge(site) : false };
}

async function closeWindow() {
  const w = win;
  win = null;
  if (w) {
    w._release();
    await w.context.close().catch(() => {});
  }
  await closing;
}

/** Raise the window if a captcha on it waits for the user (POST /window/show); → whether one did. */
export async function raiseChallenge() {
  const w = win;
  if (!w?.captcha) return false;
  await w.raise();
  return true;
}

/** End block mode: close the window and wait for it to be gone; `forget` also deletes its profile. */
export async function closeChallenge({ forget = false } = {}) {
  while (opening) await opening;
  await closeWindow();
  if (!forget) return;
  fs.rmSync(profileDir(), { recursive: true, force: true });
}
