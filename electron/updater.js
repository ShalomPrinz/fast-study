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
// The app window's view, which every check updates, rechecks included: only the two phases it shows.
let shown = null;
let onShown = () => {};
let restarting = null;

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
    const visible = next === 'downloading' || next === 'downloaded' ? next : null;
    if (visible !== shown) {
      shown = visible;
      onShown(shown);
    }
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

/** The app window's update state, `'downloading' | 'downloaded' | null`, and its one push target. */
function updateState() {
  return shown;
}
function onUpdateState(listener) {
  onShown = listener;
}

/** Kill via `stop()`, then install and relaunch — `quitAndInstall` spawns NSIS before `will-quit`.
 *  A throwing kill or a synchronous install error calls `recover()`; see docs/UPDATES.md. */
function restartToUpdate(stop, recover, log) {
  if (shown !== 'downloaded')
    return Promise.resolve({ ok: false, error: 'no update is downloaded' });
  // A second click while the first is still killing joins it rather than installing twice.
  restarting ??= (async () => {
    // Only a synchronous `error` event is caught; a failed installer launch arrives after quit is scheduled.
    let failure = null;
    const onError = (error) => (failure ??= error);
    try {
      await stop();
      autoUpdater.on('error', onError);
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      failure = error;
    } finally {
      autoUpdater.off('error', onError);
    }
    if (!failure) return { ok: true };
    restarting = null;
    log('updater', `restart failed: ${failure.message}`);
    // The services may already be dead; `shown` stays `downloaded`, so Restart now stays offered.
    recover();
    return { ok: false, error: failure.message };
  })();
  return restarting;
}

module.exports = { startUpdater, updateState, onUpdateState, restartToUpdate };
