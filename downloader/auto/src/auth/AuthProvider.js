/**
 * Serializable auth context = Playwright storageState (cookies + localStorage).
 * NOT a live browser context — auth hands over serializable state, and the site
 * facade builds its own headless context from it (keeps the two concerns split).
 * @typedef {import('playwright').BrowserContextOptions['storageState']} StorageState
 */

export class AuthProvider {
  /**
   * Return a valid, serializable auth context, loading the persisted one or
   * running the (headed) login flow if missing/expired. Persists on success.
   * @param {string} entryUrl  the course/entry URL — used as the headed-login
   *   entry point and as the headless validity-probe target.
   * @returns {Promise<StorageState>}
   */
  async getAuthState(entryUrl) {
    throw new Error('not implemented');
  }
}
