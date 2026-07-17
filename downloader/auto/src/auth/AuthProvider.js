/**
 * Serializable auth context = Playwright storageState (cookies + localStorage).
 * NOT a live browser context — auth hands over serializable state, and the site
 * facade builds its own headless context from it (keeps the two concerns split).
 * @typedef {import('playwright').BrowserContextOptions['storageState']} StorageState
 */

export class AuthProvider {
  /**
   * Start the (headed) login: open the browser at `entryUrl` and return once it's
   * up, so the user can finish MFA by hand. Paired with complete().
   * @param {string} entryUrl
   * @param {{ onCancel?: () => void }} [opts]
   * @returns {Promise<void>}
   */
  async connect(entryUrl, opts) {
    throw new Error('not implemented');
  }

  /**
   * Finish the pending login: persist the serializable auth context and close the
   * headed browser. Throws if no login is pending.
   * @returns {Promise<StorageState>}
   */
  async complete() {
    throw new Error('not implemented');
  }

  /**
   * Cheap status for the UI pill — no browser launch.
   * @returns {{ connected: boolean, expired: boolean }}
   */
  status() {
    throw new Error('not implemented');
  }
}
