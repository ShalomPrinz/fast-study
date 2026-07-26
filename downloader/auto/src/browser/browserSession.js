import { launchBrowser } from './browserLaunch.js';
import { launchZoomBrowser, stopXvfb } from './zoomBrowser.js';

// Leak-safety valve only — a browser is meant to stay open; it re-opens lazily next call.
const IDLE_TIMEOUT_MS = 45 * 60 * 1000;

/**
 * A persistent browser+context+page with its launcher INJECTED (plain vs zoom profile),
 * kept open across requests. Page ops are serialized by withLock. See docs/SESSIONS.md.
 */
export class BrowserSession {
  /** @param {() => Promise<import('playwright').Browser>} launch  profile-specific launcher */
  constructor(launch) {
    this._launch = launch;
    this.browser = null;
    this.context = null;
    this.page = null;
    this._lock = Promise.resolve(); // tail of the mutex chain
    this._idleTimer = null;
    this._authedUntil = 0; // when the Moodle autologin cookie is treated as still fresh
  }

  isOpen() {
    return !!this.page;
  }

  /**
   * Lazily launch the browser (via the injected launcher) + a blank context. No-op if
   * already open. No cookies are injected — the plain profile authenticates on demand via
   * Moodle autologin (docs/MOODLE.md); the zoom profile is passcode-gated, never BIU-auth.
   */
  async open() {
    if (this.page) return;
    this.browser = await this._launch();
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this._touch();
  }

  /** Navigate the shared page; returns the settled URL. */
  async goto(url) {
    await this.page.goto(url, { waitUntil: 'load' });
    this._touch();
    return this.page.url();
  }

  // Autologin is rate-limited (~1/user/6 min), so cache its cookie's freshness: skip a
  // re-login while an earlier one is still within ttl. Reset on close (context/cookie gone).
  isAuthed() {
    return Date.now() < this._authedUntil;
  }

  markAuthed(ttlMs) {
    this._authedUntil = Date.now() + ttlMs;
  }

  // Async mutex: chain fn onto the tail so only one page op runs at a time (two concurrent
  // /list calls on the shared page would otherwise abort each other's nav). Serializes only
  // the quick navigate+sniff; the heavy download runs afterward in server/, so it overlaps.
  withLock(fn) {
    const run = this._lock.then(fn, fn); // run regardless of the prior op's outcome
    this._lock = run.then(
      () => {},
      () => {},
    ); // a rejection must not poison the chain
    return run;
  }

  async close() {
    this._clearIdle();
    this._authedUntil = 0; // context (and its autologin cookie) is gone → re-auth next open
    const b = this.browser;
    this.browser = this.context = this.page = null;
    if (b) await b.close().catch(() => {});
  }

  _touch() {
    this._clearIdle();
    this._idleTimer = setTimeout(() => this.close().catch(() => {}), IDLE_TIMEOUT_MS);
    this._idleTimer.unref?.(); // don't keep the process alive just for the idle timer
  }

  _clearIdle() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
}

// Per-extractor browser choice. 'plain' = headless bundled Chromium; 'zoom' =
// chrome+stealth on a managed Xvfb display (docs/ZOOM.md).
const LAUNCHERS = {
  plain: () => launchBrowser({ headless: true }),
  zoom: () => launchZoomBrowser(),
};

// One lazily-built session per profile, kept open across requests (each with its own
// idle timer). An extractor's `browserProfile` selects which one it runs on.
const sessions = new Map();

export function getSession(profile = 'plain') {
  const key = LAUNCHERS[profile] ? profile : 'plain';
  if (!sessions.has(key)) sessions.set(key, new BrowserSession(LAUNCHERS[key]));
  return sessions.get(key);
}

/** Close every session and stop the managed Xvfb (on /close, idle-shutdown, or signals). */
export async function closeAllSessions() {
  await Promise.all([...sessions.values()].map((s) => s.close()));
  stopXvfb();
}
