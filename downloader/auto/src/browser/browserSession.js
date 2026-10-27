import { launchZoomBrowser, stopXvfb } from './zoomBrowser.js';

// Leak-safety valve only — a browser is meant to stay open; it re-opens lazily next call.
const IDLE_TIMEOUT_MS = 45 * 60 * 1000;

/**
 * A persistent browser+context+page with its launcher INJECTED (per browser profile),
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
    this._opening = null;
    this._held = false; // a withLock op is running: the idle timer waits for it
  }

  isOpen() {
    return !!this.page;
  }

  /**
   * Lazily launch the browser (via the injected launcher) + a blank context. No-op if
   * already open. No cookies are injected: no profile holds a Moodle session, and zoom is passcode-gated.
   * Concurrent callers share one launch, so two first requests never start two browsers.
   */
  open() {
    if (this.page) return Promise.resolve();
    this._opening ??= this._openOnce().finally(() => {
      this._opening = null;
    });
    return this._opening;
  }

  async _openOnce() {
    const browser = await this._launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      // The user may close the window at any time: forget the dead browser so the next open()
      // relaunches instead of reusing a closed page.
      browser.once('disconnected', () => this._forget(browser));
      page.once('close', () => {
        if (this.page === page) void this.close();
      });
      this.browser = browser;
      this.context = context;
      this.page = page;
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
    this._touch();
  }

  _forget(browser) {
    if (this.browser !== browser) return;
    this._clearIdle();
    this.browser = this.context = this.page = null;
  }

  /** Navigate the shared page; returns the settled URL. */
  async goto(url) {
    await this.page.goto(url, { waitUntil: 'load' });
    this._touch();
    return this.page.url();
  }

  // Async mutex: one page op at a time, or two calls on the shared page abort each other's
  // navigation. Only the quick navigate+sniff; downloads run later in server/ and overlap.
  // The idle timer is paused while an op holds the lock and re-armed when it ends, so it measures
  // real idleness and never closes the browser under a running capture.
  withLock(fn) {
    const op = async () => {
      this._held = true;
      this._clearIdle();
      try {
        return await fn();
      } finally {
        this._held = false;
        if (this.page) this._touch();
      }
    };
    const run = this._lock.then(op, op); // run regardless of the prior op's outcome
    this._lock = run.then(
      () => {},
      () => {},
    ); // a rejection must not poison the chain
    return run;
  }

  async close() {
    const b = this.browser;
    this._forget(b);
    if (b) await b.close().catch(() => {});
  }

  _touch() {
    this._clearIdle();
    if (this._held) return;
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

// Playwright rejects a call on a closed window with a plain Error carrying this text, not TargetClosedError;
// re-check the wording on every Playwright upgrade (docs/MOODLE.md#constraints).
const CLOSED_MESSAGE = /Target page, context or browser has been closed/;

/** The browser or its page went away under a call: the user closed the window. */
export function browserClosed(err, page) {
  return (
    err?.name === 'TargetClosedError' ||
    CLOSED_MESSAGE.test(err?.message ?? '') ||
    page?.isClosed?.() === true
  );
}

// Per-extractor browser choice. 'zoom' = headed chrome+stealth, hidden per platform (docs/ZOOM.md).
const LAUNCHERS = {
  zoom: () => launchZoomBrowser(),
};

// One lazily-built session per profile, kept open across requests (each with its own
// idle timer). An extractor's `browserProfile` selects which one it runs on.
const sessions = new Map();

/** Tests swap a profile's launcher (dropping its session); → a function restoring the previous ones. */
export function configureSessions(overrides) {
  const prev = { ...LAUNCHERS };
  const reset = () => {
    for (const p of Object.keys(overrides)) sessions.delete(p);
  };
  Object.assign(LAUNCHERS, overrides);
  reset();
  return () => {
    Object.assign(LAUNCHERS, prev);
    reset();
  };
}

export function getSession(profile) {
  if (!LAUNCHERS[profile]) throw new Error(`no browser profile '${profile}'`);
  if (!sessions.has(profile)) sessions.set(profile, new BrowserSession(LAUNCHERS[profile]));
  return sessions.get(profile);
}

/** Close every session and stop the managed Xvfb, if any (on /close and shutdown signals). */
export async function closeAllSessions() {
  await Promise.all([...sessions.values()].map((s) => s.close()));
  stopXvfb();
}
