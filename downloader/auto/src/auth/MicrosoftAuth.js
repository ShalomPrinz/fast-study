import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AuthProvider } from './AuthProvider.js';

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

/**
 * @param {string} finalUrl  the URL after navigation + redirects settled
 * @returns {boolean}  true if we landed on a Microsoft login page (= unauthenticated)
 */
function isLoginUrl(finalUrl) {
  try {
    const u = new URL(finalUrl);
    if (LOGIN_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return true;
    if (LOGIN_PATH_RE.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Prompt on the terminal and resolve when the user presses Enter. */
function waitForEnter(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Launch a browser, trying bare Chromium first. Microsoft login sometimes flags
 * automation on bundled Chromium; if the launch throws, retry with the system
 * Chrome channel (real Chrome is less likely to be blocked).
 * @param {{ headless: boolean }} opts
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchBrowser(opts) {
  try {
    return await chromium.launch(opts);
  } catch (err) {
    // Fallback: bundled Chromium failed to launch (or MS blocked it). Retry with
    // the installed Google Chrome. TODO: if MS blocks *bare Chromium* at the login
    // step (launch succeeds but login is rejected) rather than at launch, force
    // `channel: 'chrome'` for the headed path unconditionally instead.
    console.warn(`Chromium launch failed (${err.message}); retrying with channel: 'chrome'…`);
    return chromium.launch({ ...opts, channel: 'chrome' });
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
  }

  /**
   * @param {string} entryUrl  course/entry URL — headed-login entry + probe target
   * @returns {Promise<import('./AuthProvider.js').StorageState>}
   */
  async getAuthState(entryUrl) {
    if (fs.existsSync(this.statePath)) {
      const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (await this._isValid(state, entryUrl)) {
        console.log(`Reusing persisted auth state (${this.statePath}).`);
        return state;
      }
      console.log('Persisted auth state expired — re-running headed login.');
      // fall through to the headed login and re-persist.
    }
    return this._headedLogin(entryUrl);
  }

  /**
   * Cheap validity probe: open a headless context with the saved state, navigate
   * the entry URL, and treat a redirect to a Microsoft login host as expired.
   * @param {import('./AuthProvider.js').StorageState} state
   * @param {string} entryUrl
   * @returns {Promise<boolean>}
   */
  async _isValid(state, entryUrl) {
    const browser = await launchBrowser({ headless: true });
    try {
      const context = await browser.newContext({ storageState: state });
      const page = await context.newPage();
      // `waitUntil: 'load'` lets client-side auth redirects settle before we read
      // the final URL; a login-gated SPA bounces here if the cookies are stale.
      await page.goto(entryUrl, { waitUntil: 'load' });
      const finalUrl = page.url();
      return !isLoginUrl(finalUrl);
    } catch (err) {
      // A probe failure (nav error, timeout) is inconclusive; treat as invalid so
      // we fall back to the interactive login rather than trusting a stale state.
      console.warn(`Auth validity probe failed (${err.message}); treating as invalid.`);
      return false;
    } finally {
      await browser.close();
    }
  }

  /**
   * Headed login: open a real browser, let the user finish Microsoft login + MFA
   * once, then persist storageState to disk.
   * @param {string} entryUrl
   * @returns {Promise<import('./AuthProvider.js').StorageState>}
   */
  async _headedLogin(entryUrl) {
    const browser = await launchBrowser({ headless: false });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(entryUrl, { waitUntil: 'load' });

      // DOM-agnostic completion signal: we don't know BIU's post-login DOM yet, so
      // we ask the human to confirm on the terminal instead of racing a selector.
      // TODO: once the real course DOM is known, replace this with a selector wait
      //   (e.g. page.waitForSelector('<logged-in element>')) for a hands-off flow.
      console.log('\nA browser window has opened. Complete the Microsoft login + MFA there.');
      await waitForEnter('When you are fully logged in, press Enter here to save the session… ');

      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      const state = await context.storageState({ path: this.statePath });
      console.log(`Saved auth state to ${this.statePath}.`);
      return state;
    } finally {
      await browser.close();
    }
  }
}
