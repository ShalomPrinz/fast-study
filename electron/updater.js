const { app } = require('electron');
// Safe at module scope: `autoUpdater` is a lazy getter that builds the platform updater on first
// access, so nothing platform-specific is constructed here — see the guard in `startUpdater`.
const { autoUpdater } = require('electron-updater');
const { wirePhases } = require('./updatePhases');

// One check per launch. `runBoot()` can be re-run by the launch screen's Try again, and a second
// check would download the same release twice.
let started = false;
let phase = null;
const listeners = new Set();

/** Check GitHub Releases once, download in the background, install on quit. `log` is main's
 *  `log(source, line)`; `onPhase` (optional, may arrive on a later call, replayed with the current
 *  phase) feeds the launch screen's failure view — see docs/UPDATES.md. */
function startUpdater(log, onPhase) {
  // Dev never updates: outside a package there is no `app-update.yml` and every call throws.
  if (!app.isPackaged) return;
  if (onPhase) {
    listeners.add(onPhase);
    if (phase) onPhase(phase);
  }
  if (started) return;
  started = true;

  autoUpdater.logger = {
    info: (message) => log('updater', String(message)),
    warn: (message) => log('updater', `warn: ${message}`),
    error: (message) => log('updater', `error: ${message}`),
    debug: () => {},
  };
  // Both are electron-updater's defaults, set explicitly because they are the decision: download
  // without asking, and hand the file to NSIS on quit.
  autoUpdater.autoDownload = true;
  // Runs on `quit`, after main's `will-quit` kill — load-bearing, see docs/UPDATES.md.
  autoUpdater.autoInstallOnAppQuit = true;

  const { fail } = wirePhases(autoUpdater, (next) => {
    phase = next;
    for (const listener of listeners) listener(next);
  });

  // An EventEmitter with no `error` listener rethrows, so without this a download failing long
  // after the check would crash the app mid-pipeline.
  autoUpdater.on('error', (error) => {
    log('updater', `error: ${error.message}`);
  });

  autoUpdater.on('update-downloaded', ({ version }) => {
    log('updater', `version ${version} downloaded — it installs when the app quits`);
  });

  // Offline is the ordinary case: an unhandled rejection here would crash a machine merely offline.
  autoUpdater.checkForUpdates().catch((error) => {
    log('updater', `check failed: ${error.message}`);
    fail();
  });
}

module.exports = { startUpdater };
