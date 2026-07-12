import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// import { chromium } from 'playwright';  // TODO: enable once the login flow is implemented
import { AuthProvider } from './AuthProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/auth/ -> src/ -> auto/  (statePath is relative to the package root)
const PKG_ROOT = path.resolve(__dirname, '../..');

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

  /** @returns {Promise<import('./AuthProvider.js').StorageState>} */
  async getAuthState() {
    if (fs.existsSync(this.statePath)) {
      const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (await this._isValid(state)) return state;
      // else fall through to the headed login and re-persist.
    }
    return this._headedLogin();
  }

  /**
   * Cheap validity probe: open a headless context with the saved state, hit an
   * authenticated URL, and confirm we're not bounced to login.microsoftonline.com.
   * @param {import('./AuthProvider.js').StorageState} _state
   * @returns {Promise<boolean>}
   */
  async _isValid(_state) {
    // TODO: launch headless chromium with { storageState: _state }, navigate an
    // authenticated URL, return false if redirected to login.microsoftonline.com.
    // Stub: assume any persisted state is usable so the skeleton runs end-to-end.
    return true;
  }

  /**
   * Headed login: open a real browser, let the user finish Microsoft login + MFA
   * once, then persist storageState to disk.
   * @returns {Promise<import('./AuthProvider.js').StorageState>}
   */
  async _headedLogin() {
    // TODO(headed login): implement per plan §6.
    //   1. const browser = await chromium.launch({ headless: false });
    //      (consider channel: 'chrome' — MS login sometimes flags bare Chromium.)
    //   2. Navigate the BIU login entry URL (see plan §9.2).
    //   3. Wait for the post-login success signal (URL/selector), or prompt the
    //      user to press Enter on the terminal once logged in.
    //   4. await context.storageState({ path: this.statePath }); close; return it.
    throw new Error(
      `MicrosoftAuth headed login not implemented — no persisted state at ${this.statePath}. ` +
        'See AUTO_DOWNLOADER_PLAN.md §6 / §9.',
    );
  }
}
