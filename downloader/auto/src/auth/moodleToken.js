import fs from 'node:fs';
import { AuthProvider } from './AuthProvider.js';
import { launchBrowser } from '../browser/browserLaunch.js';
import { getSiteInfo, blocked, invalidToken } from '../moodle/wsClient.js';
import { readTokenFile, writeTokenFile } from './tokenStore.js';
import { CodedError, UnsupportedError, failureOf } from '../lib/errors.js';
import { reportUnsupportedSite } from '../../siteReport.js';

const SERVICE = 'moodle_mobile_app';
const URLSCHEME = 'moodlemobile';
const TOKEN_PREFIX = `${URLSCHEME}://token=`;
// Bounded wait from Connect for the user to finish a first Microsoft login plus SMS in the headed window.
export const CAPTURE_TIMEOUT_MS = 600_000;
// What discovery and PDFs need from the token's service; videostream capture also needs autologin.
const REQUIRED_FUNCTION = 'core_course_get_contents';
const AUTOLOGIN_FUNCTION = 'tool_mobile_get_autologin_key';

// The apptoken arrives as raw base64 in a moodlemobile://token=<b64> redirect.
// Decode it to Moodle's ':::'-joined payload.
export function decodeApptoken(raw) {
  for (const candidate of [raw, safeURIDecode(raw)]) {
    const decoded = Buffer.from(candidate, 'base64').toString('utf8');
    if (decoded.includes(':::')) return decoded;
  }
  return Buffer.from(raw, 'base64').toString('utf8'); // best effort
}

// A dead token is the same reconnect signal here as on the 401 the WS routes answer.
function failureOfAttempt(err) {
  return invalidToken(err)
    ? { error: err.message, code: 'moodle_reconnect_required', params: {} }
    : failureOf(err);
}

function safeURIDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Moodle Web-Services token auth for one site: one headed launch.php grab (MFA by hand), then a
 * persisted { site, wstoken, privatetoken, userid } for the stateless WS API. See docs/AUTH.md.
 */
export class MoodleToken extends AuthProvider {
  /**
   * @param {{ tokenPath: string, site: string, launch?: typeof launchBrowser, onChange?: () => void }} opts
   *   absolute token file path (core/registry.js owns where it lives); `launch` is injectable so tests
   *   need no browser; `onChange` fires whenever `state()` may have changed.
   */
  constructor({ tokenPath, site, launch = launchBrowser, onChange = () => {} }) {
    super();
    this.tokenPath = tokenPath;
    this.site = site;
    this._launch = launch;
    this._onChange = onChange;
    // The headed window of the login in flight, so disconnect() can close it. Null once captured.
    this._pending = null;
    // A background login (capture → persist → verify) is running; `_gen` bumps on disconnect so a
    // superseded run ends quietly. `_error` is the last failed attempt, cleared by the next connect.
    this._driving = false;
    this._gen = 0;
    this._error = null;
    // Runtime "known invalid" flag: set by a caller when wsClient.invalidToken fires (a
    // server-side token kill the token file can't reveal), cleared by the next complete().
    this._invalidated = false;
    // The headed window opened on the site root for the user to solve a bot-protection challenge.
    this._challenge = null;
    // The in-flight verification, shared so concurrent callers make one site-info call.
    this._verifying = null;
  }

  /** Mark this instance's token dead after a runtime invalidToken WS response. */
  markExpired() {
    this._invalidated = true;
    this._onChange();
  }

  /**
   * The stored token, or null when there is none or it was minted for another site — a token is
   * only good on the site that issued it, so a leftover from before a site switch reads as absent.
   * @returns {{ site: string, wstoken: string, privatetoken: string|null, userid: number, savedAt: string }|null}
   */
  loadToken() {
    const tok = readTokenFile(this.tokenPath);
    return tok?.site === this.site ? tok : null;
  }

  /**
   * Cheap status for the UI pill — no browser, no API call. `connected` = a token file with a
   * wstoken exists. Token validity is only knowable by hitting the API, so `expired` is purely
   * the runtime markExpired flag (a WS invalidToken response), not a cookie-expiry heuristic.
   * `unverified` = persisted after a bot-protection block, its site info not yet checked.
   * @returns {{ connected: boolean, expired: boolean, unverified: boolean }}
   */
  status() {
    const tok = this.loadToken();
    const connected = !!(tok && tok.wstoken);
    return {
      connected,
      expired: connected && this._invalidated,
      unverified: connected && tok.unverified === true,
    };
  }

  /**
   * What the frontend renders: `status()` plus the login `phase` and the last attempt's failure.
   * `pending` covers the whole background login, including its verification.
   * @returns {{ phase: 'idle'|'pending'|'connected'|'unverified', connected: boolean, expired: boolean, unverified: boolean, error?: { code: string, params: object } }}
   */
  state() {
    const status = this.status();
    const phase = this._driving
      ? 'pending'
      : status.unverified
        ? 'unverified'
        : status.connected
          ? 'connected'
          : 'idle';
    const error = this._error ? { code: this._error.code, params: this._error.params } : null;
    return { phase, ...status, ...(error ? { error } : {}) };
  }

  /**
   * Forget the token locally: delete the file (ENOENT is success — already disconnected), clear the
   * runtime invalidated flag so a reconnect starts clean, and close any headed login left in flight.
   * Deliberately no server-side revoke: it could fail after the local delete and desync the two.
   */
  async disconnect() {
    fs.rmSync(this.tokenPath, { force: true });
    this._invalidated = false;
    this._gen++; // the run in flight ends quietly: its abandoned/failed outcome is not reported
    this._driving = false;
    this._error = null;
    await this._closeChallenge();
    const pending = this._pending;
    this._pending = null;
    if (pending) await pending.browser.close().catch(() => {});
    this._onChange();
  }

  /**
   * UI-triggered login: open the headed launch.php and return; the login then runs to its end in the
   * background (see `_drive`) whatever happens to the caller's request. Idempotent while one runs.
   * Only a failure to open the window throws; every later outcome shows up in `state()`.
   */
  async connect() {
    if (this._driving) return;
    const gen = ++this._gen;
    this._driving = true;
    this._error = null;
    await this._closeChallenge();
    let pending;
    try {
      pending = await this._openLogin();
    } catch (err) {
      if (gen === this._gen) this._driving = false;
      this._onChange();
      throw err;
    }
    // A disconnect or site switch during the launch superseded this login: nothing owns the window yet.
    if (gen !== this._gen) {
      await pending.browser.close().catch(() => {});
      return;
    }
    this._pending = pending;
    this._onChange();
    void this._drive(pending, gen);
  }

  // Opens the headed window and starts watching it; resolves once launch.php is requested.
  async _openLogin() {
    const browser = await this._launch({ headless: false });
    try {
      const context = await browser.newContext();

      // Chromium can't follow moodlemobile://, so watch all three signals the token can surface
      // on, and close the window on capture. See docs/MOODLE.md.
      let apptoken = null;
      let resolveToken;
      const tokenPromise = new Promise((resolve) => {
        resolveToken = resolve;
      });
      // Rejected when the login is abandoned.
      let abandon;
      const abandoned = new Promise((_, reject) => {
        abandon = reject;
      });
      abandoned.catch(() => {}); // _drive may not be racing it yet
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

      // The browser closing before a token is captured = login abandoned; our own post-capture
      // close is a success, so it is guarded on apptoken.
      browser.on('disconnected', () => {
        if (apptoken) return;
        abandon(
          new CodedError(
            'moodle_login_abandoned',
            {},
            'login window closed before a token was captured',
          ),
        );
      });

      const passport = String(Date.now()) + String(Math.floor(Math.random() * 1e6));
      const launchUrl =
        `${this.site}/admin/tool/mobile/launch.php` +
        `?service=${SERVICE}&passport=${passport}&urlscheme=${URLSCHEME}`;
      await page.goto(launchUrl, { waitUntil: 'load' }).catch(() => {});
      return { browser, tokenPromise, abandoned };
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  // The login's background run: wait (bounded) for the apptoken, verify it, and only then let it
  // replace the stored token (see `_verifyOnce`).
  // Never throws: a failure becomes `_error`. A run superseded by disconnect() (`gen` moved) is silent.
  async _drive({ browser, tokenPromise, abandoned }, gen) {
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new CodedError('moodle_login_timeout', {}, 'no token captured (timed out)')),
          CAPTURE_TIMEOUT_MS,
        );
        timer.unref?.();
      });
      const apptoken = await Promise.race([tokenPromise, abandoned, timeout]);
      if (gen !== this._gen) return;
      this._pending = null;

      const parts = decodeApptoken(apptoken).split(':::');
      const candidate = {
        site: this.site,
        wstoken: parts[1],
        privatetoken: parts[2] ?? null,
        userid: null,
        unverified: true,
        savedAt: new Date().toISOString(),
      };
      await browser.close().catch(() => {});
      await this._verifyOnce(candidate, gen);
      if (gen === this._gen) this._error = null;
    } catch (err) {
      if (gen === this._gen) this._error = failureOfAttempt(err);
    } finally {
      clearTimeout(timer);
      await browser.close().catch(() => {});
      if (gen === this._gen) {
        if (this._pending?.browser === browser) this._pending = null;
        this._driving = false;
        this._onChange();
      }
    }
  }

  /**
   * Re-verify the stored unverified token now (a block on the last try, the challenge since solved).
   * Throws moodle_login_not_pending when none is stored; otherwise as `verifiedToken()`.
   * @returns {Promise<object>}  the verified token record
   */
  async complete() {
    if (!this.status().unverified) {
      throw new CodedError('moodle_login_not_pending', {}, 'no unverified token to verify');
    }
    return this._verifyReporting();
  }

  /**
   * The stored token, verified first when it is still unverified; null when there is none. Every
   * WS caller goes through this, so an unverified token is checked before its first use.
   */
  async verifiedToken() {
    const tok = this.loadToken();
    if (tok?.unverified) return this._verifyReporting();
    return tok;
  }

  // A verification called on its own (retry, lazy first use): its outcome becomes state. While a
  // login runs, _drive reports instead.
  async _verifyReporting() {
    const gen = this._gen;
    try {
      const record = await this._verify();
      if (gen === this._gen) this._error = null;
      return record;
    } catch (err) {
      if (gen === this._gen) this._error = failureOfAttempt(err);
      throw err;
    } finally {
      if (!this._driving) this._onChange();
    }
  }

  _verify() {
    this._verifying ??= this._verifyOnce().finally(() => {
      this._verifying = null;
    });
    return this._verifying;
  }

  // Verifies the stored token, or a freshly captured `candidate` that is held in memory until its
  // outcome is known. Deletes the stored file only for a not-good-token answer (invalidtoken or a
  // refused site) on the stored token: a refused candidate leaves the existing token untouched.
  // A candidate replaces the file when verified, or unverified on a block, timeout or network
  // failure (nothing says it is bad, and re-capturing costs an MFA); a block opens the challenge window.
  async _verifyOnce(candidate = null, gen = this._gen) {
    const tok = candidate ?? this.loadToken();
    if (!tok) throw new CodedError('moodle_login_not_pending', {}, 'no token to verify');
    let info;
    try {
      info = await getSiteInfo(this.site, tok.wstoken);
      this._checkSiteInfo(info);
    } catch (err) {
      const refused = invalidToken(err) || err instanceof UnsupportedError;
      if (candidate) {
        if (gen === this._gen && !refused) {
          writeTokenFile(this.tokenPath, candidate);
          this._invalidated = false;
        }
      } else if (refused) {
        fs.rmSync(this.tokenPath, { force: true });
      }
      if (blocked(err) && (!candidate || gen === this._gen)) {
        err.params = { ...err.params, challengeWindow: await this._openChallenge() };
      }
      throw err;
    }
    // A disconnect or a newer login while the call was out wins over this result.
    if (candidate ? gen !== this._gen : this.loadToken()?.wstoken !== tok.wstoken) return tok;
    const record = { ...tok, userid: info.userid };
    delete record.unverified;
    writeTokenFile(this.tokenPath, record);
    this._invalidated = false;
    await this._closeChallenge();
    return record;
  }

  // Headed browser on the site root so the bot manager shows its challenge to a human; reused while
  // open. Returns whether a window is up (false when no browser could be launched).
  async _openChallenge() {
    if (this._challenge) return true;
    let browser;
    try {
      browser = await this._launch({ headless: false });
      const page = await (await browser.newContext()).newPage();
      this._challenge = browser;
      browser.on('disconnected', () => {
        if (this._challenge === browser) this._challenge = null;
      });
      await page.goto(this.site, { waitUntil: 'load' }).catch(() => {});
      return true;
    } catch {
      await browser?.close().catch(() => {});
      this._challenge = null;
      return false;
    }
  }

  async _closeChallenge() {
    const browser = this._challenge;
    this._challenge = null;
    if (browser) await browser.close().catch(() => {});
  }

  // The post-login check: refuse a site whose token service can't list a course or serve its
  // files; a missing autologin only costs videostream capture, so it connects and is reported.
  _checkSiteInfo(info) {
    const functions = new Set((info?.functions ?? []).map((f) => f.name));
    const refuse = (reason, extra = {}) => {
      reportUnsupportedSite({ site: this.site, stage: 'login', reason, release: info?.release });
      return new UnsupportedError(
        'moodle_site_unsupported',
        { site: this.site, reason, ...extra },
        `${this.site} cannot be used: ${reason}`,
      );
    };
    if (!functions.has(REQUIRED_FUNCTION)) {
      throw refuse('missing_function', { function: REQUIRED_FUNCTION });
    }
    if (Number(info?.downloadfiles) !== 1) throw refuse('downloads_disabled');
    if (!functions.has(AUTOLOGIN_FUNCTION)) {
      reportUnsupportedSite({
        site: this.site,
        stage: 'login',
        reason: 'autologin_unavailable',
        release: info?.release,
      });
    }
  }
}
