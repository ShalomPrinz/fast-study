const { safeStorage } = require('electron');

/** The machine-level facts the app degrades on, probed once at boot and carried for the launch.
 *  Every check here must be cheap — no network, no spawn, no real disk work — because they run
 *  inline in the boot path, and none may fail a launch: a check reports, it does not decide. */
function runStartupChecks() {
  return {
    // Whether an API key can be stored at all. False on a machine with no key store — a Linux box
    // with no keyring — where the settings screens disable the key fields and say so, rather than
    // letting a key reach a save that store.js would refuse.
    secureStorage: safeStorage.isEncryptionAvailable(),
  };
}

module.exports = { runStartupChecks };
