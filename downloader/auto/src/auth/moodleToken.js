import fs from 'node:fs';
import path from 'node:path';
import { AuthProvider } from './AuthProvider.js';
import { launchBrowser } from '../browser/browserLaunch.js';
import { DEFAULT_SITE } from '../moodle/wsClient.js';

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
 * Moodle Web-Services token auth for BIU. Authenticate once headed (user completes MFA by
 * hand) via admin/tool/mobile/launch.php; capture the moodlemobile://token redirect, decode
 * it, and persist { wstoken, privatetoken }. Thereafter the token authenticates the stateless
 * WS API with no browser and no re-MFA — the Google-Drive-refresh-token model, native to Moodle.
 */
export class MoodleToken extends AuthProvider {
  /** @param {{ tokenPath: string, site?: string }} opts  absolute token file path; the caller (core/registry.js) owns where it lives. */
  constructor({ tokenPath, site = DEFAULT_SITE }) {
    super();
    this.tokenPath = tokenPath;
    this.site = site;
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
   * UI-triggered login, step 1: open the headed launch.php and start capturing the token
   * redirect. Returns immediately (user finishes MFA by hand). Idempotent while pending.
   * @param {{ onCancel?: () => void }} [opts]  onCancel fires if the headed browser closes
   *   BEFORE complete() consumes it (user abandoned the login).
   */
  async connect({ onCancel } = {}) {
    if (this._pending) return;
    const browser = await launchBrowser({ headless: false });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Chromium can't follow the custom moodlemobile:// scheme, so the token surfaces on
      // whichever signal fires first — the redirect's Location header, the failed navigation
      // to the custom scheme, or the frame's URL. Watch all three (redundant by design).
      // On capture we close the headed window immediately: complete() persists from the
      // already-resolved token string and doesn't need a live browser, so leaving the window
      // open would just strand the user on a dead tab + Chromium's xdg-open prompt for the
      // unknown moodlemobile:// scheme (looks like a hang).
      let apptoken = null;
      let resolveToken;
      const tokenPromise = new Promise((resolve) => {
        resolveToken = resolve;
      });
      const grab = (url) => {
        if (url && url.startsWith(TOKEN_PREFIX) && !apptoken) {
          apptoken = url.slice(TOKEN_PREFIX.length);
          resolveToken(apptoken);
          browser.close().catch(() => {});
        }
      };
      context.on('response', (resp) => grab(resp.headers()['location'] || ''));
      context.on('requestfailed', (req) => grab(req.url()));
      page.on('framenavigated', (f) => grab(f.url()));

      const passport = String(Date.now()) + String(Math.floor(Math.random() * 1e6));
      const launchUrl =
        `${this.site}/admin/tool/mobile/launch.php` +
        `?service=${SERVICE}&passport=${passport}&urlscheme=${URLSCHEME}`;
      await page.goto(launchUrl, { waitUntil: 'load' }).catch(() => {});

      this._pending = { browser, context, tokenPromise };
      // "Login abandoned" signal = the headed browser closing before a token is captured.
      // apptoken is truthy only after grab() fired our own post-capture close, so guard on it:
      // a self-close is a SUCCESS, not a cancellation — misfiring here would null _pending and
      // break complete() ("no pending login").
      browser.on('disconnected', () => {
        if (apptoken) return;
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
   * UI-triggered login, step 2: wait (bounded) for the captured apptoken, decode it, persist
   * { wstoken, privatetoken }, and close the headed browser. Throws if no login is pending or
   * no token was captured before the timeout.
   * @returns {Promise<{ wstoken: string, privatetoken: string|null, savedAt: string }>}
   */
  async complete() {
    if (!this._pending) throw new Error('no pending login (call connect first)');
    const { browser, tokenPromise } = this._pending;
    this._pending = null;
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('no token captured (timed out)')), CAPTURE_TIMEOUT_MS),
      );
      const apptoken = await Promise.race([tokenPromise, timeout]);

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
      await browser.close().catch(() => {});
    }
  }
}
