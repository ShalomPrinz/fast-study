import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthProvider } from './AuthProvider.js';
import { launchBrowser } from '../browser/browserLaunch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/auth/ -> src/ -> auto/  (statePath is relative to the package root)
const PKG_ROOT = path.resolve(__dirname, '../..');

// A bounce to any of these means "not authenticated" (AAD / MSA login, or a same-host
// /login page if BIU proxies the flow).
const LOGIN_HOSTS = ['login.microsoftonline.com', 'login.live.com'];
const LOGIN_PATH_RE = /\/login(\/|$|\?)/i;
// An expired/guest BIU session doesn't bounce to a Microsoft login — Moodle silently
// redirects to its enrol gate (zero li.activity), so catch it too or /list returns []
// instead of steering to Reconnect. See docs/AUTH.md.
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
    // Headed login in progress; held on the instance so connect() and complete() (two
    // HTTP calls) share the same live headed browser. Null when none pending.
    this._pending = null;
    // Runtime "known invalid" flag: a live login/enrol bounce sets it (the cookie
    // heuristic can't see a server-side kill), cleared by the next complete().
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

  // Expired = no still-valid dated cookie (session cookies can't prove freshness).
  // A cheap read of cookie `expires`, avoiding a browser launch on every poll.
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
      // "Login ended" signal = the headed browser closing. The reference check fires
      // onCancel ONLY for a genuine abandon (still the pending browser), not for the
      // close complete() itself does after clearing _pending.
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
