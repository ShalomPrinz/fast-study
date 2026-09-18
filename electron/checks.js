const { safeStorage } = require('electron');

/** The machine-level facts the app degrades on. Each must be cheap and none may fail a launch — a
 *  check reports, it does not decide (docs/BOOT.md). */
function runStartupChecks() {
  return {
    // False with no key store (a Linux box without a keyring): the screens disable the key fields
    // rather than let a key reach a save store.js would refuse.
    secureStorage: safeStorage.isEncryptionAvailable(),
  };
}

module.exports = { runStartupChecks };
