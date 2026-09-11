const { app } = require('electron');
// Safe at module scope: `autoUpdater` is a lazy getter that builds the platform updater on first
// access, so nothing platform-specific is constructed here — see the guard in `startUpdater`.
const { autoUpdater } = require('electron-updater');

// One check per launch. `runBoot()` can be re-run by the launch screen's Try again, and a second
// check would download the same release twice.
let started = false;

/** Check GitHub Releases once, download in the background, install on quit. Nothing reaches the
 *  screen: `log` — main's `log(source, line)` — is the whole user-visible surface of updates, so a
 *  silent feature stays diagnosable from `launch.log`. See `docs/UPDATES.md`. */
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
  // `autoInstallOnAppQuit` runs on `app.once('quit')`, which fires *after* `will-quit` — where
  // main's synchronous `killChildren()` runs. That ordering is load-bearing: the installer replaces
  // `resources/` wholesale, so every service must be dead and off those files before it starts.
  // Moving the kill to a later hook would break in-place updates, and no dev run would show it.
  autoUpdater.autoInstallOnAppQuit = true;

  // electron-updater emits `error` for every failure, including a download that dies long after the
  // check resolved. An EventEmitter with no `error` listener rethrows, so this listener is what
  // keeps a failed update from ending a run mid-pipeline.
  autoUpdater.on('error', (error) => {
    log('updater', `error: ${error.message}`);
  });

  autoUpdater.on('update-downloaded', ({ version }) => {
    log('updater', `version ${version} downloaded — it installs when the app quits`);
  });

  // An unreachable GitHub is the ordinary offline case, not a fault: log it and carry on. An
  // unhandled rejection here would surface as a crash on a machine that is merely offline.
  autoUpdater.checkForUpdates().catch((error) => {
    log('updater', `check failed: ${error.message}`);
  });
}

module.exports = { startUpdater };
