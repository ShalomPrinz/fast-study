import { launchBrowser } from './browserLaunch.js';
import { isLoginUrl } from './auth/MicrosoftAuth.js';

// Safety valve only — the browser is meant to stay open (the ~1–2s launch + auth
// context build is paid once). Auto-close after this long idle so a forgotten
// server doesn't hold a headless Chromium forever; it re-opens lazily next call.
const IDLE_TIMEOUT_MS = 45 * 60 * 1000;

// How long to wait for a login bounce to auto-redirect back to a real page. The
// Moodle session can idle out while the persistent AAD cookie is still alive, so
// SSO often completes silently (no MFA) within a couple seconds. A genuinely dead
// AAD session parks on the login/MFA form instead, so this timeout is what tells
// the two apart — long enough to cover the redirect chain, short enough to fail fast.
const SILENT_REAUTH_TIMEOUT_MS = 12_000;

/**
 * The ONE persistent headless browser+context+page the HTTP service drives. All
 * browsing endpoints share this single page; switching course is just goto(). Page
 * ops are serialized by withLock so one call's navigate can't interrupt another's
 * sniff. Built lazily from a storageState and kept open across requests.
 */
export class BrowserSession {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this._lock = Promise.resolve(); // tail of the mutex chain
    this._idleTimer = null;
  }

  isOpen() {
    return !!this.page;
  }

  /** Lazily launch the headless browser + build a context from storageState. No-op if already open. */
  async open(storageState) {
    if (this.page) return;
    this.browser = await launchBrowser({ headless: true });
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

  // Navigate, but treat a login/enrol bounce as maybe-recoverable instead of fatal.
  // wait (bounded) for the persistent AAD cookie to auto-redirect back to a real
  //         page. Resolves → silent recovery (re-save the refreshed rolling cookies via
  //         auth.saveState); times out → AAD session truly gone → return null so the
  //         caller runs its markExpired()/reconnect path. MUST be called inside withLock.
  // Returns { url, recovered } on success, or null when recovery failed (unrecoverable).
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

  // Async mutex: chain fn onto the tail so only one page op runs at a time.
  // Before: two /list calls goto the same shared page concurrently → one nav aborts the other.
  // After:  each awaits its turn; only the quick navigate+sniff is serialized — the heavy
  //         download runs afterward in server.js, so parallel downloads still overlap there.
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

// One process-wide session — every browsing endpoint operates on it.
export const session = new BrowserSession();
