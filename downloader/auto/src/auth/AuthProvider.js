// Auth provider contract: a headed login (MFA by hand) that runs to its end in the background,
// persists a long-lived credential, then serves it statelessly. See MoodleToken / docs/AUTH.md.
export class AuthProvider {
  /**
   * Start the (headed) login and return once it's up, so the user can finish MFA by
   * hand; the provider finishes it itself and reports through its state.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('not implemented');
  }

  /**
   * Re-verify a stored credential that is not yet verified. Throws if there is none.
   * @returns {Promise<object>}
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

  /**
   * Forget the stored credential locally and drop any pending login. Succeeds when there
   * is nothing stored, so disconnecting twice is not an error.
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('not implemented');
  }
}
