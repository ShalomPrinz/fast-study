const { app } = require('electron');
// Safe at module scope: `autoUpdater` is a lazy getter that builds the platform updater on first
// access, so nothing platform-specific is constructed here — see the guard in `startUpdater`.
const { autoUpdater } = require('electron-updater');

// One check per launch. `runBoot()` can be re-run by the launch screen's Try again, and a second
// check would download the same release twice.
let started = false;

/** Check GitHub Releases once, download in the background, install on quit. `log` is main's
 *  `log(source, line)`, the feature's whole surface — see docs/UPDATES.md. */
function startUpdater(log) {
  // Dev never updates: outside a package there is no `app-update.yml` and every call throws.
  if (!app.isPackaged || started) return;
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
  });
}

module.exports = { startUpdater };
