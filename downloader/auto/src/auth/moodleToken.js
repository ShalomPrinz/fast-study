import fs from 'node:fs';
import path from 'node:path';
import { AuthProvider } from './AuthProvider.js';
import { launchBrowser } from '../browser/browserLaunch.js';
import { DEFAULT_SITE } from '../moodle/wsClient.js';
import { CodedError } from '../lib/errors.js';

const SERVICE = 'moodle_mobile_app';
const URLSCHEME = 'moodlemobile';
const TOKEN_PREFIX = `${URLSCHEME}://token=`;
// Bounded wait for the user to finish MFA in the headed window, matching the probe.
const CAPTURE_TIMEOUT_MS = 180_000;

// The apptoken arrives as raw base64 in a moodlemobile://token=<b64> redirect.
// Decode it to Moodle's ':::'-joined payload.
export function decodeApptoken(raw) {
  for (const candidate of [raw, safeURIDecode(raw)]) {
    const decoded = Buffer.from(candidate, 'base64').toString('utf8');
    if (decoded.includes(':::')) return decoded;
  }
  return Buffer.from(raw, 'base64').toString('utf8'); // best effort
}

function safeURIDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Moodle Web-Services token auth for BIU: one headed launch.php grab (MFA by hand), then a
 * persisted { wstoken, privatetoken } for the stateless WS API. See docs/AUTH.md, docs/MOODLE.md.
 */
export class MoodleToken extends AuthProvider {
  /**
   * @param {{ tokenPath: string, site?: string, launch?: typeof launchBrowser }} opts  absolute token
   *   file path (core/registry.js owns where it lives); `launch` is injectable so tests need no browser.
   */
  constructor({ tokenPath, site = DEFAULT_SITE, launch = launchBrowser }) {
    super();
    this.tokenPath = tokenPath;
    this.site = site;
    this._launch = launch;
    // Headed login in progress; held on the instance so connect() and complete() (two HTTP
    // calls) share the same live headed browser + its capture promise. Null when none pending.
    this._pending = null;
    // Runtime "known invalid" flag: set by a caller when wsClient.invalidToken fires (a
    // server-side token kill the token file can't reveal), cleared by the next complete().
    this._invalidated = false;
  }

  /** Mark this instance's token dead after a runtime invalidToken WS response. */
  markExpired() {
    this._invalidated = true;
  }

  /** @returns {{ wstoken: string, privatetoken: string|null, savedAt: string }|null} */
  loadToken() {
    try {
      if (!fs.existsSync(this.tokenPath)) return null;
      return JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Cheap status for the UI pill — no browser, no API call. `connected` = a token file with a
   * wstoken exists. Token validity is only knowable by hitting the API, so `expired` is purely
   * the runtime markExpired flag (a WS invalidToken response), not a cookie-expiry heuristic.
   * @returns {{ connected: boolean, expired: boolean }}
   */
  status() {
    const tok = this.loadToken();
    const connected = !!(tok && tok.wstoken);
    return { connected, expired: connected && this._invalidated };
  }

  /**
   * Forget the token locally: delete the file (ENOENT is success — already disconnected), clear the
   * runtime invalidated flag so a reconnect starts clean, and close any headed login left in flight.
   * Deliberately no server-side revoke: it could fail after the local delete and desync the two.
   */
  async disconnect() {
    fs.rmSync(this.tokenPath, { force: true });
    this._invalidated = false;
    const pending = this._pending;
    // Null before closing: the browser's 'disconnected' handler treats a live _pending as an
    // abandoned login and would fire onCancel, which this is not.
    this._pending = null;
    if (pending) await pending.browser.close().catch(() => {});
  }

  /**
   * UI-triggered login, step 1: open the headed launch.php and start capturing the token
   * redirect. Returns immediately (user finishes MFA by hand). Idempotent while pending.
   * @param {{ onCancel?: () => void }} [opts]  onCancel fires if the headed browser closes
   *   BEFORE complete() consumes it (user abandoned the login).
   */
  async connect({ onCancel } = {}) {
    if (this._pending) return;
    const browser = await this._launch({ headless: false });
    try {
      const context = await browser.newContext();

      // Chromium can't follow moodlemobile://, so watch all three signals the token can surface
      // on, and close the window on capture — complete() needs no live browser. See docs/MOODLE.md.
      let apptoken = null;
      let resolveToken;
      const tokenPromise = new Promise((resolve) => {
        resolveToken = resolve;
      });
      // Rejected when the login is abandoned, so a complete() already waiting fails at once.
      let abandon;
      const abandoned = new Promise((_, reject) => {
        abandon = reject;
      });
      abandoned.catch(() => {}); // nobody may be racing it yet
      const grab = (url) => {
        if (url && url.startsWith(TOKEN_PREFIX) && !apptoken) {
          apptoken = url.slice(TOKEN_PREFIX.length);
          resolveToken(apptoken);
          browser.close().catch(() => {});
        }
      };
      context.on('response', (resp) => grab(resp.headers()['location'] || ''));
      context.on('requestfailed', (req) => grab(req.url()));
      // Closing the last window does not end a Playwright-launched browser, so 'disconnected' alone
      // never sees the user give up: no pages left without a token = abandoned (SSO may open popups).
      context.on('page', (p) =>
        p.on('close', () => {
          if (!apptoken && context.pages().length === 0) browser.close().catch(() => {});
        }),
      );
      const page = await context.newPage();
      page.on('framenavigated', (f) => grab(f.url()));

      this._pending = { browser, context, tokenPromise, abandoned };
      // The browser closing before a token is captured = login abandoned. Our own post-capture
      // close is a success, so guard on apptoken or complete() would find no pending login.
      browser.on('disconnected', () => {
        if (apptoken) return;
        abandon(
          new CodedError(
            'moodle_login_abandoned',
            {},
            'login window closed before a token was captured',
          ),
        );
        if (this._pending && this._pending.browser === browser) {
          this._pending = null;
          onCancel?.();
        }
      });

      const passport = String(Date.now()) + String(Math.floor(Math.random() * 1e6));
      const launchUrl =
        `${this.site}/admin/tool/mobile/launch.php` +
        `?service=${SERVICE}&passport=${passport}&urlscheme=${URLSCHEME}`;
      await page.goto(launchUrl, { waitUntil: 'load' }).catch(() => {});
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  /**
   * UI-triggered login, step 2: wait (bounded) for the captured apptoken, decode it, persist
   * { wstoken, privatetoken }, and close the headed browser. Throws if no login is pending, the
   * window is closed first, or no token was captured before the timeout.
   * @returns {Promise<{ wstoken: string, privatetoken: string|null, savedAt: string }>}
   */
  async complete() {
    if (!this._pending) {
      throw new CodedError('moodle_login_not_pending', {}, 'no pending login (call connect first)');
    }
    const { browser, tokenPromise, abandoned } = this._pending;
    this._pending = null;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new CodedError('moodle_login_timeout', {}, 'no token captured (timed out)')),
          CAPTURE_TIMEOUT_MS,
        );
      });
      const apptoken = await Promise.race([tokenPromise, abandoned, timeout]);

      const parts = decodeApptoken(apptoken).split(':::');
      const record = {
        wstoken: parts[1],
        privatetoken: parts[2] ?? null,
        savedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
      fs.writeFileSync(this.tokenPath, JSON.stringify(record));
      this._invalidated = false; // fresh token persisted — a prior runtime invalidToken is no longer sticky
      return record;
    } finally {
      clearTimeout(timer);
      await browser.close().catch(() => {});
    }
  }
}
