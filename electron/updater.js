const fs = require('./appFs');
const path = require('node:path');
const { app } = require('electron');
// Safe at module scope: `autoUpdater` is a lazy getter that builds the platform updater on first
// access, so nothing platform-specific is constructed here — see the guard in `startUpdater`.
const { autoUpdater } = require('electron-updater');
const { wirePhases } = require('./updatePhases');
const { bundlePath, launchHelper, stageUpdate } = require('./macUpdate');
const { encode } = require('./macHandoff');
const pending = require('./macPending');
const store = require('./store');

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
// The version `update-downloaded` reported; read through `updateVersion()`, which hides it unless `shown` is `downloaded`.
let downloadedVersion = null;
// macOS only: the update Restart now swaps in — `{bundle, staged, stateDir}`.
let macStaged = null;

/** Check GitHub Releases at launch and every 30 minutes, download in the background, install on quit
 *  (Windows) or at the next launch (macOS). `log` is main's
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

  // Registered before `wirePhases` so the version is set by the time the `downloaded` push reaches the window.
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info?.version ?? null;
  });

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
    const when = MAC ? 'at the next launch, or on Restart now' : 'when the app quits';
    log('updater', `version ${version} downloaded — it installs ${when}`);
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
    const dir = path.join(stateDir, 'update');
    const last = pending.read(dir);
    // One launch-time install per version: a release that failed it waits for the next one.
    if (last?.state === 'failed' && last.version === info.version) {
      log('updater', `version ${info.version} is not downloaded again: ${last.reason}`);
      return autoUpdater.emit('update-not-available', info);
    }
    const bundle = bundlePath(process.execPath);
    const staged = await stageUpdate({
      files: autoUpdater.updateInfoAndProvider.provider.resolveFiles(info),
      version: info.version,
      dir,
      bundle,
    });
    macStaged = { bundle, staged, stateDir };
    autoUpdater.emit('update-downloaded', info);
  } catch (error) {
    autoUpdater.emit('error', error);
  }
}

/** macOS: start the helper that swaps `staged` over `bundle` once this process is gone and starts
 *  the new build with every stored key, decrypted here, on its handoff pipe. Throws if it cannot start. */
function startSwap({ bundle, staged, stateDir }, log) {
  const logFile = path.join(stateDir, 'logs', 'update.log');
  let handoff = null;
  try {
    handoff = encode(store.secrets());
  } catch (error) {
    // No handoff: the helper reopens with `open`, and the new build leaves the old item alone.
    log(
      'updater',
      `installing without a key handoff, the stored keys are left as they were: ${error.message}`,
    );
  }
  const pid = launchHelper({ pid: process.pid, bundle, staged, logFile, handoff });
  log('updater', `install helper started (pid ${pid}) — it logs to ${logFile}`);
}

/** macOS, at launch and before anything is spawned: install the update an earlier run staged. True
 *  when the helper is started and the caller must quit; false to boot this build. One try per
 *  version, and never a throw — docs/UPDATES.md. */
async function installPending(stateDir, log) {
  const dir = path.join(stateDir, 'update');
  const say = (line) => log('updater', line);
  try {
    const record = pending.read(dir);
    const action = pending.decide(record, app.getVersion());
    if (action === 'clear') {
      fs.rmSync(dir, { recursive: true, force: true });
      say(
        `pending update cleared: ${record.version ?? 'an unreadable record'} is not newer than this build`,
      );
    }
    if (action === 'fail') {
      pending.fail(dir, record.version, 'its install at an earlier launch did not complete');
      say(
        `version ${record.version} did not install at the last launch and is not tried again — see logs/update.log`,
      );
    }
    if (action !== 'install') return false;
    return await swapPending(record, dir, stateDir, log);
  } catch (error) {
    say(`pending update not installed: ${error.message}`);
    return false;
  }
}

/** Check the staged build against its recorded digest and turn the record `attempted`, so no later
 *  launch of this build starts a second swap. Throws on a mismatch; answers the staged path. */
async function verifyAndMark(record, dir) {
  const staged = path.join(dir, 'staged', path.basename(String(record.app)));
  const began = Date.now();
  if ((await pending.treeDigest(staged)) !== record.digest) {
    throw new Error('the staged build changed on disk after it was downloaded');
  }
  pending.write(dir, { ...record, state: 'attempted' });
  return { staged, ms: Date.now() - began };
}

/** Verify the staged build, mark it attempted and hand it to the helper. */
async function swapPending(record, dir, stateDir, log) {
  const { version } = record;
  const say = (line) => log('updater', line);
  const bundle = bundlePath(process.execPath);
  try {
    // A copy on a read-only mount leaves the update to the copy that staged it.
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    say(`version ${version} stays pending: ${path.dirname(bundle)} is not writable`);
    return false;
  }
  try {
    const { staged, ms } = await verifyAndMark(record, dir);
    say(`version ${version} verified in ${ms}ms — installing it before this launch`);
    startSwap({ bundle, staged, stateDir }, log);
    return true;
  } catch (error) {
    pending.fail(dir, version, error.message);
    say(`version ${version} not installed and not tried again: ${error.message}`);
    return false;
  }
}

/** The app window's update state, `'downloading' | 'downloaded' | null`, and its one push target. */
function updateState() {
  return shown;
}
/** The downloaded update's version while `updateState()` is `'downloaded'`, otherwise `null`. */
function updateVersion() {
  return shown === 'downloaded' ? downloadedVersion : null;
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
    let swapVersion = null;
    let marked = null;
    const dir = MAC ? path.join(macStaged.stateDir, 'update') : null;
    if (MAC) {
      // Before the kill: a staged build that fails here leaves the services running.
      const record = pending.read(dir);
      try {
        if (record?.state !== 'pending') throw new Error('no staged update is waiting to install');
        const { ms } = await verifyAndMark(record, dir);
        swapVersion = record.version;
        marked = record;
        log('updater', `version ${record.version} verified in ${ms}ms — installing it on restart`);
      } catch (error) {
        if (record?.state === 'pending') pending.fail(dir, record.version, error.message);
        restarting = null;
        // The version is failed or has nothing staged: no click can succeed, so the button goes.
        shown = null;
        onShown(null);
        const which = record?.version
          ? `version ${record.version} is not tried again`
          : 'no update';
        log('updater', `restart not started, ${which}: ${error.message}`);
        return { error: error.message };
      }
    }
    // Only a synchronous `error` event is caught; a failed installer launch arrives after quit is scheduled.
    let failure = null;
    let quitHook = null;
    const onError = (error) => (failure ??= error);
    try {
      await stop();
      autoUpdater.on('error', onError);
      if (MAC) {
        // `quit` follows main's `will-quit` kill, so the helper starts once every service is dead.
        quitHook = () => {
          try {
            startSwap(macStaged, log);
          } catch (error) {
            // The record is `attempted`; the reopened build must not offer this version again.
            pending.fail(path.join(macStaged.stateDir, 'update'), swapVersion, error.message);
            log('updater', `install helper not started: ${error.message}`);
          }
        };
        app.once('quit', quitHook);
        app.quit();
      } else {
        autoUpdater.quitAndInstall(false, true);
      }
    } catch (error) {
      failure = error;
      // A retry registers its own hook; a stale one would start a second helper.
      if (quitHook) app.off('quit', quitHook);
    } finally {
      autoUpdater.off('error', onError);
    }
    if (!failure) return;
    restarting = null;
    log('updater', `restart failed: ${failure.message}`);
    // No swap ran: a retry click or the next launch must still find the record `pending`.
    if (marked) pending.write(dir, marked);
    // The services may already be dead; `shown` stays `downloaded`, so Restart now stays offered.
    recover();
    return { error: failure.message };
  })();
  return restarting;
}

module.exports = {
  installPending,
  startUpdater,
  updateState,
  updateVersion,
  onUpdateState,
  restartToUpdate,
};
