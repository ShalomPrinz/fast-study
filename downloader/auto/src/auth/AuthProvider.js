// Auth provider contract: a two-step headed login (MFA by hand) that persists a
// long-lived credential, then serves it statelessly. See MoodleToken / docs/AUTH.md.
export class AuthProvider {
  /**
   * Start the (headed) login and return once it's up, so the user can finish MFA by
   * hand. Paired with complete().
   * @param {{ onCancel?: () => void }} [opts]  onCancel fires if the login is abandoned.
   * @returns {Promise<void>}
   */
  async connect(opts) {
    throw new Error('not implemented');
  }

  /**
   * Finish the pending login: persist the credential and close the headed browser.
   * Throws if no login is pending.
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
}
