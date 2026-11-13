const path = require('node:path');
const { app } = require('electron');
// Safe at module scope: `autoUpdater` is a lazy getter that builds the platform updater on first
// access, so nothing platform-specific is constructed here — see the guard in `startUpdater`.
const { autoUpdater } = require('electron-updater');
const { wirePhases } = require('./updatePhases');
const { bundlePath, launchHelper, stageUpdate } = require('./macUpdate');

// macOS installs by its own bundle swap: Squirrel.Mac refuses an ad-hoc signed build (docs/UPDATES.md).
const MAC = process.platform === 'darwin';

const RECHECK_MS = 30 * 60 * 1000;

// One updater per launch: `runBoot()` can be re-run by the launch screen's Try again, and a second
// start would add a second timer and download the same release twice.
let started = false;
let phase = null;
const listeners = new Set();
// The app window's view, which every check updates, rechecks included: only the two phases it shows.
let shown = null;
let onShown = () => {};
let restarting = null;
// macOS only: the unpacked update awaiting the swap, and whether the helper relaunches after it.
let staged = null;
let relaunch = false;

/** Check GitHub Releases at launch and every 30 minutes, download in the background, install on quit. `log` is main's
 *  `log(source, line)`; `onPhase` (optional, may arrive on a later call, replayed with the current
 *  phase) feeds the launch screen's failure view — see docs/UPDATES.md. `stateDir` is the state
 *  root, where macOS stages the download and logs the swap. */
function startUpdater(log, onPhase, stateDir) {
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
  // Off on macOS, where either would hand the update to Squirrel.Mac.
  autoUpdater.autoDownload = !MAC;
  // Runs on `quit`, after main's `will-quit` kill — load-bearing, see docs/UPDATES.md.
  autoUpdater.autoInstallOnAppQuit = !MAC;
  // The app ships only the full `nsis` installer, never `nsis-web`.
  autoUpdater.disableWebInstaller = true;

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
      const result = await autoUpdater.checkForUpdates();
      // A failed download already reached the `error` listener; this only drops its duplicate rejection.
      result?.downloadPromise?.catch(() => {});
      if (MAC && result?.isUpdateAvailable) await stageMacUpdate(result.updateInfo, stateDir, log);
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
    // A check mid-download only re-emits `checking-for-update`, which would blank the window's row.
    if (shown === 'downloading') return;
    rechecked = true;
    check(() => {});
  }, RECHECK_MS);
  timer.unref();
}

/** macOS: download and unpack the update ourselves, then report it on electron-updater's own events
 *  so the phases, the timer and the log line are the ones Windows gets. Never throws. */
async function stageMacUpdate(info, stateDir, log) {
  try {
    const bundle = bundlePath(process.execPath);
    staged = await stageUpdate({
      files: autoUpdater.updateInfoAndProvider.provider.resolveFiles(info),
      dir: path.join(stateDir, 'update'),
      bundle,
    });
    // `quit` follows main's `will-quit` kill, so the helper starts once every service is dead.
    app.once('quit', () => {
      const logFile = path.join(stateDir, 'logs', 'update.log');
      try {
        const pid = launchHelper({ pid: process.pid, bundle, staged, relaunch, logFile });
        log('updater', `install helper started (pid ${pid}) — it logs to ${logFile}`);
      } catch (error) {
        log('updater', `install helper not started: ${error.message}`);
      }
    });
    autoUpdater.emit('update-downloaded', info);
  } catch (error) {
    autoUpdater.emit('error', error);
  }
}

/** The app window's update state, `'downloading' | 'downloaded' | null`, and its one push target. */
function updateState() {
  return shown;
}
function onUpdateState(listener) {
  onShown = listener;
}

/** Kill via `stop()`, then install and relaunch — `quitAndInstall` spawns NSIS before `will-quit`.
 *  Answers `undefined` or `{error}`; a throwing kill or synchronous install error calls `recover()`. */
function restartToUpdate(stop, recover, log) {
  if (shown !== 'downloaded') return Promise.resolve({ error: 'no update is downloaded' });
  // A second click while the first is still killing joins it rather than installing twice.
  restarting ??= (async () => {
    // Only a synchronous `error` event is caught; a failed installer launch arrives after quit is scheduled.
    let failure = null;
    const onError = (error) => (failure ??= error);
    try {
      await stop();
      autoUpdater.on('error', onError);
      if (MAC) {
        // The `quit` hook does the install; this only asks its helper to reopen the app.
        relaunch = true;
        app.quit();
      } else {
        autoUpdater.quitAndInstall(false, true);
      }
    } catch (error) {
      failure = error;
    } finally {
      autoUpdater.off('error', onError);
    }
    if (!failure) return;
    restarting = null;
    log('updater', `restart failed: ${failure.message}`);
    // The services may already be dead; `shown` stays `downloaded`, so Restart now stays offered.
    recover();
    return { error: failure.message };
  })();
  return restarting;
}

module.exports = { startUpdater, updateState, onUpdateState, restartToUpdate };
