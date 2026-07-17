import { launchBrowser } from './browserLaunch.js';
import { launchZoomBrowser, stopXvfb } from './zoomBrowser.js';
import { isLoginUrl } from './auth/MicrosoftAuth.js';

// Leak-safety valve only — a browser is meant to stay open; it re-opens lazily next call.
const IDLE_TIMEOUT_MS = 45 * 60 * 1000;

// Bound on a silent-SSO redirect: long enough for the AAD cookie to auto-redirect back,
// short enough that a dead session parked on the login form fails fast. See docs/AUTH.md.
const SILENT_REAUTH_TIMEOUT_MS = 12_000;

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
  }

  isOpen() {
    return !!this.page;
  }

  /** Lazily launch the browser (via the injected launcher) + build a context from storageState. No-op if already open. */
  async open(storageState) {
    if (this.page) return;
    this.browser = await this._launch();
    this.context = await this.browser.newContext({ storageState });
    this.page = await this.context.newPage();
    this._touch();
  }

  /** Navigate the shared page; returns the settled URL (for login-redirect detection). */
  async goto(url) {
    await this.page.goto(url, { waitUntil: 'load' });
    this._touch();
    return this.page.url();
  }

  // Navigate, treating a login/enrol bounce as maybe-recoverable: wait (bounded) for the
  // AAD cookie to silently redirect back and re-save the refreshed cookies. Returns
  // { url, recovered } on success, or null when recovery failed. MUST run inside withLock.
  async gotoAuthenticated(url, auth) {
    let finalUrl = await this.goto(url);
    if (!isLoginUrl(finalUrl)) return { url: finalUrl, recovered: false };
    try {
      await this.page.waitForURL((u) => !isLoginUrl(String(u)), { timeout: SILENT_REAUTH_TIMEOUT_MS });
    } catch {
      return null; // login/MFA form just sat there → credentials really required
    }
    finalUrl = this.page.url();
    // Persisting the refreshed state is best-effort — a failed write shouldn't sink an
    // otherwise-successful recovery; the in-memory context is already re-authenticated.
    try {
      auth.saveState(await this.context.storageState());
    } catch (e) {
      console.warn(`Failed to persist recovered auth state: ${e.message}`);
    }
    return { url: finalUrl, recovered: true };
  }

  // Async mutex: chain fn onto the tail so only one page op runs at a time (two concurrent
  // /list calls on the shared page would otherwise abort each other's nav). Serializes only
  // the quick navigate+sniff; the heavy download runs afterward in server/, so it overlaps.
  withLock(fn) {
    const run = this._lock.then(fn, fn); // run regardless of the prior op's outcome
    this._lock = run.then(() => {}, () => {}); // a rejection must not poison the chain
    return run;
  }

  // Re-auth invalidates the old cookies, so build a fresh context from the new
  // storageState. The browser process can stay — only the context is stale.
  async rebuildContext(storageState) {
    if (!this.browser) return this.open(storageState);
    if (this.context) await this.context.close().catch(() => {});
    this.context = await this.browser.newContext({ storageState });
    this.page = await this.context.newPage();
    this._touch();
  }

  async close() {
    this._clearIdle();
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

/** Re-point every OPEN session's context at fresh cookies (after /auth/complete). */
export async function rebuildOpenSessions(storageState) {
  await Promise.all(
    [...sessions.values()].filter((s) => s.isOpen()).map((s) => s.rebuildContext(storageState)),
  );
}

/** Close every session and stop the managed Xvfb (on /close, idle-shutdown, or signals). */
export async function closeAllSessions() {
  await Promise.all([...sessions.values()].map((s) => s.close()));
  stopXvfb();
}
