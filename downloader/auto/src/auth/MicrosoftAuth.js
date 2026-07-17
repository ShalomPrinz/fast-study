import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthProvider } from './AuthProvider.js';
import { launchBrowser } from '../browserLaunch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/auth/ -> src/ -> auto/  (statePath is relative to the package root)
const PKG_ROOT = path.resolve(__dirname, '../..');

// Hosts / path fragments that mean "not authenticated": if the probe URL bounces
// to any of these, the persisted session has expired and we must re-login.
// Assumption: BIU's Microsoft OAuth redirects to one of these on an expired
// session (login.microsoftonline.com for AAD, login.live.com for MSA); the
// bare `/login` path catches a same-host login page if BIU proxies the flow.
const LOGIN_HOSTS = ['login.microsoftonline.com', 'login.live.com'];
const LOGIN_PATH_RE = /\/login(\/|$|\?)/i;
// An expired/guest BIU session does NOT bounce to a Microsoft login page — Moodle
// silently redirects the course view to its enrol gate (/enrol/index.php), a page
// with zero li.activity. Without catching it, /list scrapes an empty page and
// returns [] ("No recordings found") instead of steering the UI to Reconnect.
// Before: expired session → goto lands on /enrol/index.php → isLoginUrl=false → []
// After:  expired session → /enrol/index.php matched → reconnect (401)
const ENROL_GATE_RE = /\/enrol\/index\.php/i;

/**
 * @param {string} finalUrl  the URL after navigation + redirects settled
 * @returns {boolean}  true if the landed page means the session is unusable — a
 *   Microsoft login page or Moodle's enrol gate — so the caller should Reconnect.
 */
export function isLoginUrl(finalUrl) {
  try {
    const u = new URL(finalUrl);
    if (LOGIN_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return true;
    if (LOGIN_PATH_RE.test(u.pathname)) return true;
    if (ENROL_GATE_RE.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Microsoft OAuth for BIU. First login is headed (user completes MFA by hand
 * once); every run after reuses the persisted storageState headlessly. Direct
 * analogue of the backend's cached Google Drive OAuth token.
 */
export class MicrosoftAuth extends AuthProvider {
  /** @param {{ statePath: string }} opts  storageState path, relative to the package root */
  constructor({ statePath }) {
    super();
    this.statePath = path.isAbsolute(statePath) ? statePath : path.join(PKG_ROOT, statePath);
    // A headed login in progress (connect() → complete()), for the UI-triggered
    // flow. Null when no login is pending. Held on the instance so connect and
    // complete — two separate HTTP calls — share the same live headed browser.
    this._pending = null;
    // Runtime "known invalid" flag. The cheap cookie heuristic in status() can't
    // see a server-side session kill, so a live login/enrol bounce during /list or
    // /download-item flips this until the next successful complete() clears it.
    this._invalidated = false;
  }

  /** Mark this cached instance's session dead after a runtime login/enrol bounce. */
  markExpired() {
    this._invalidated = true;
  }

  /** @returns {import('./AuthProvider.js').StorageState|null}  parsed persisted state, or null. */
  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return null;
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Cheap status for the UI pill — no browser launch. `connected` = a state file
   * exists; `expired` uses cookie `expires` timestamps as a fast heuristic (the
   * real redirect-to-login check happens on /list).
   * @returns {{ connected: boolean, expired: boolean }}
   */
  status() {
    const state = this.loadState();
    if (!state) return { connected: false, expired: false };
    return { connected: true, expired: this._invalidated || this._isExpired(state) };
  }

  // A storageState is "expired" when it carries no still-valid dated cookie.
  // Session cookies (expires -1) are ignored — they can't prove freshness.
  // Before: probing validity meant launching a headless browser on every poll.
  // After:  read cookie `expires`; expired = every dated cookie is already past.
  _isExpired(state) {
    const now = Date.now() / 1000;
    const dated = (state.cookies ?? []).filter((c) => typeof c.expires === 'number' && c.expires > 0);
    if (!dated.length) return false; // only session cookies → can't tell cheaply; let /list decide
    return !dated.some((c) => c.expires > now);
  }

  /**
   * UI-triggered login, step 1: open the headed browser at the login entry and
   * return immediately (the user finishes MFA by hand). Idempotent — a second
   * call while a login is already pending is a no-op.
   * @param {string} entryUrl
   * @param {{ onCancel?: () => void }} [opts]  onCancel fires when the headed browser
   *   closes/dies BEFORE complete() consumes it (user abandoned the login). Optional.
   */
  async connect(entryUrl, { onCancel } = {}) {
    if (this._pending) return;
    const browser = await launchBrowser({ headless: false });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(entryUrl, { waitUntil: 'load' });
      this._pending = { browser, context };
      // The login spans two HTTP calls (connect / complete) with no shared async
      // scope a finally could release on, so the "login ended" signal is the headed
      // browser closing. The reference check makes this fire ONLY for a genuine cancel:
      // Before: complete() succeeds → complete() sets _pending=null THEN browser.close()
      //         → disconnected fires but _pending.browser !== browser → no-op (correct).
      // After:  user closes the window pre-complete → _pending.browser === browser still
      //         → clear _pending and signal onCancel (release the parked browsing gate).
      browser.on('disconnected', () => {
        if (this._pending && this._pending.browser === browser) {
          this._pending = null;
          onCancel?.();
        }
      });
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  /**
   * UI-triggered login, step 2: persist storageState from the pending headed
   * browser and close it. Throws if no login is pending.
   * @returns {Promise<import('./AuthProvider.js').StorageState>}
   */
  async complete() {
    if (!this._pending) throw new Error('no pending login (call connect first)');
    const { browser, context } = this._pending;
    this._pending = null;
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      const state = await context.storageState({ path: this.statePath });
      this._invalidated = false; // fresh state persisted — a prior runtime bounce is no longer sticky
      return state;
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /**
   * Persist a refreshed storageState after a silent SSO recovery — the AAD cookie
   * completed the login redirect without MFA, so re-saving the now-rolling cookies
   * keeps the session window extending across runs. Mirrors how complete() writes.
   * @param {import('./AuthProvider.js').StorageState} state
   */
  saveState(state) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state));
  }
}
