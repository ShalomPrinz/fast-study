const { app } = require('electron');
// Safe at module scope: `autoUpdater` is a lazy getter that builds the platform updater on first
// access, so nothing platform-specific is constructed here — see the guard in `startUpdater`.
const { autoUpdater } = require('electron-updater');
const { wirePhases } = require('./updatePhases');

const RECHECK_MS = 4 * 60 * 60 * 1000;

// One updater per launch: `runBoot()` can be re-run by the launch screen's Try again, and a second
// start would add a second timer and download the same release twice.
let started = false;
let phase = null;
const listeners = new Set();

/** Check GitHub Releases at launch and every 4 hours, download in the background, install on quit. `log` is main's
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

  // The launch screen's phases describe the launch check only; once a recheck has run they freeze.
  let rechecked = false;
  const { fail } = wirePhases(autoUpdater, (next) => {
    if (rechecked) return;
    phase = next;
    for (const listener of listeners) listener(next);
  });

  // An EventEmitter with no `error` listener rethrows, so without this a download failing long
  // after the check would crash the app mid-pipeline.
  autoUpdater.on('error', (error) => {
    log('updater', `error: ${error.message}`);
  });

  let timer = null;
  autoUpdater.on('update-downloaded', ({ version }) => {
    // A later check could re-download and replace the pending installer.
    clearInterval(timer);
    log('updater', `version ${version} downloaded — it installs when the app quits`);
  });

  // Checks never overlap: a tick that lands on a running check is skipped.
  let checking = false;
  const check = async (onError) => {
    if (checking) return;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // Offline is the ordinary case: an unhandled rejection here would crash a machine merely offline.
      log('updater', `check failed: ${error.message}`);
      onError();
    } finally {
      checking = false;
    }
  };

  check(fail);
  timer = setInterval(() => {
    rechecked = true;
    check(() => {});
  }, RECHECK_MS);
  timer.unref();
}

module.exports = { startUpdater };
