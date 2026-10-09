// Block mode: while the site's bot manager blocks us, one headed Chrome on a persistent profile is
// open on the site, and moodleFetch sends Moodle calls through its page — the only client whose
// clearance the bot manager honours. Closing it ends block mode. See docs/MOODLE.md § Bot protection.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { statePath } from '@faststudy/runtime';
import { launchPersistentBrowser } from '../browser/browserLaunch.js';
import { moodleGate, enterMoodle } from './gate.js';

// Chrome clamps it to about -13107, still far off-screen; the flag beats the profile's saved position.
const OFF_SCREEN = { left: -32000, top: -32000 };
const ON_SCREEN = { left: 80, top: 80 };
const LAUNCH_ARGS = [`--window-position=${OFF_SCREEN.left},${OFF_SCREEN.top}`];
// A body crosses from the page in slices this size, base64-encoded.
const CHUNK = 4 * 1024 * 1024;
const NULL_BODY = new Set([101, 204, 205, 304]);

const deps = { launch: launchPersistentBrowser, idleMs: 10 * 60_000 };
let win = null;
let opening = null;
let closing = Promise.resolve();

/** 'change' whenever `challengeState()` may have changed; /auth/events subscribes. */
export const challengeEvents = new EventEmitter();
const publish = () => challengeEvents.emit('change');

/** Tests swap the launcher and the idle timeout; → a function restoring the previous ones. */
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

// Runs in the page. Keeps the body there and hands back its head; Node pulls the body in slices.
async function pageFetch({ url, method, headers, body }) {
  const r = await fetch(url, {
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

// A page fetch cannot set User-Agent (Chrome drops it), and the clearance is tied to the browser's own.
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
    this.ended = false;
    this.closed = new Promise((resolve) => context.once('close', resolve));
    this.closed.then(() => this._ended());
    // The user solving the captcha lands the page back on the site: the lock is theirs no longer,
    // even if their retry never reaches Moodle (a replay-cache hit).
    page.on?.('framenavigated', () => {
      if (this.captcha && this.onSite()) void this.passed();
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
   * `url` fetched by the page, as a Node Response: redirects unfollowed, the browser's own UA. A body
   * slice the page can no longer hand over (closed, or navigated away) errors the body with `lost()`.
   */
  async fetch(
    url,
    init = {},
    { lost = () => new Error('the challenge window lost the body') } = {},
  ) {
    this.touch();
    const head = await abortable(
      this.page.evaluate(pageFetch, {
        url: String(url),
        method: init.method ?? 'GET',
        headers: pageHeaders(init.headers),
        body: pageBody(init.body),
      }),
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

  _body({ id, size }, signal, lost) {
    if (!id || size === 0) {
      if (id) this.page.evaluate(pageDrop, id).catch(() => {});
      return '';
    }
    let offset = 0;
    return new ReadableStream({
      pull: async (ctl) => {
        signal?.throwIfAborted();
        const b64 = await this.page
          .evaluate(pageChunk, { id, offset, length: CHUNK })
          .catch(() => null);
        if (b64 == null) throw lost();
        const bytes = Buffer.from(b64, 'base64');
        offset += bytes.length;
        ctl.enqueue(new Uint8Array(bytes));
        if (offset >= size) ctl.close();
      },
      cancel: () => this.page.evaluate(pageDrop, id).catch(() => {}),
    });
  }

  /** A call through the window passed: the captcha is behind us, so off-screen and lock free. */
  async passed() {
    if (!this.captcha) return;
    this.captcha = false;
    this._release();
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
    publish();
    await this._bounds(ON_SCREEN);
    await this.page.bringToFront().catch(() => {});
    return 'captcha';
  }

  // Block mode ends after this long with no Moodle call through the window.
  touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (win === this) void closeChallenge();
    }, deps.idleMs);
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

  // Window position through CDP; cosmetic, so a failure never fails the call.
  async _bounds(bounds) {
    try {
      const cdp = await this.context.newCDPSession(this.page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds });
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
    context = await deps.launch(profileDir(), {
      headless: false,
      viewport: null,
      args: LAUNCH_ARGS,
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

/** End block mode: close the window and wait for it to be gone; `forget` also deletes the profile. */
export async function closeChallenge({ forget = false } = {}) {
  while (opening) await opening;
  await closeWindow();
  if (forget) fs.rmSync(profileDir(), { recursive: true, force: true });
}
