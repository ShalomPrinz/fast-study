const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
// An ES module, loaded by require(esm) — synchronous, which an init that must beat `ready` needs.
const sentryPolicy = require('@faststudy/sentry');
const { runStartupChecks } = require('./checks');
const { APP_ORIGIN, registerScheme, serveBundle } = require('./protocol');
const { reportsOn, sentryEnv, writeSettings } = require('./reports');
const store = require('./store');
const { startUpdater } = require('./updater');
const { reapChildren, signalChildren } = require('./teardown');

const REPO_ROOT = path.resolve(__dirname, '..');
// One secret per launch, in every child's environment and in the renderer's bridge. 32 bytes of
// hex, not a uuid: the services compare it in constant time and never parse it.
const SECRET = randomBytes(32).toString('hex');
const PORT_LINE = /^FASTSTUDY_PORT=(\d+)$/;
const HEALTH_TIMEOUT_MS = 60_000;
// Longer than a service's own Sentry shutdown flush (~2s), so a clean exit is never cut short.
const KILL_GRACE_MS = 3000;
// Env wins so dev and tests can point elsewhere; the packaged value is stamped into package.json at
// build. Neither set means no DSN anywhere: main and every child report nothing. The user's switch
// does not blank it — it gates each process's transport, so it can flip without a restart.
const SENTRY_DSN = process.env.FASTSTUDY_SENTRY_DSN || require('./package.json').sentryDsn || '';
// One value for main and every child, so all five processes report under the same environment.
const SENTRY_ENVIRONMENT = app.isPackaged ? 'production' : 'development';

// Per-user writable state: what `statePath`/`state_path` join onto in every service. Passed
// explicitly rather than left to their fallback, so main's log lands beside the children's state.
const STATE_DIR = app.isPackaged
  ? path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'FastStudy')
  : path.join(REPO_ROOT, '.state');

const LOG_FILE = path.join(STATE_DIR, 'logs', 'launch.log');
// The init wall's prefilled data folder: a suggestion only — nothing creates it until the user saves.
const DEFAULT_DATA_ROOT = path.join(STATE_DIR, 'data');

const LOG_TAIL_BYTES = 200_000;
// The values the scrub reads from env that main holds elsewhere: the secret in a constant, the
// rest in the settings store.
const SCRUB_ENV = ['DATA_ROOT', 'GROQ_API_KEY', 'GEMINI_API_KEY'];

const children = [];
// In-flight SIGTERM→SIGKILL escalations; every exit path waits on them, or the timer dies with main.
const reaping = new Set();
let logStream = null;
let mainWindow = null;
// The launch screen's whole model: one row per child plus the failure, if the boot hit one.
let bootState = null;
let booting = false;
let serviceUrls = {};
// The main-process SDK, loaded only when a DSN is set; null otherwise, and everything here no-ops.
let sentry = null;

// The policy read its flag from main's env at import; the store's answer is the one that counts.
sentryPolicy.setReporting(reportsOn());
// Sentry must init before the app is ready; it runs first so an exception anywhere below is caught.
initSentry();
// Must run before the app is ready, or the scheme is registered too late to be privileged.
registerScheme();

/** Init the main-process SDK from the shared policy, or do nothing when no DSN is set. Inits whether
 *  reports are on or off: off is the policy's transport gate, since a second init throws here. */
function initSentry() {
  if (!sentryPolicy.enabled(SENTRY_DSN)) return;
  sentry = require('@sentry/electron/main');
  sentry.init({
    ...sentryPolicy.options('electron', {
      dsn: SENTRY_DSN,
      version: app.getVersion(),
      environment: SENTRY_ENVIRONMENT,
    }),
    beforeSend,
    // The gate sits under the offline queue: that queue re-sends saved envelopes ~5s after init,
    // past the client's own checks, and the gate drains them unsent while off.
    transport: sentry.makeElectronOfflineTransport(sentryPolicy.gate(sentry.makeElectronTransport)),
    // Renderers reach main over the SDK's own preload, which it registers on the session and which
    // runs sandboxed. No `sentry-ipc://` fallback: its privileged-scheme registration wraps `app://`'s.
    ipcMode: sentry.IPCMode.Classic,
    // A minidump is raw process memory — decrypted keys, DATA_ROOT paths — that no scrub can reach.
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== 'SentryMinidump'),
  });
}

/** `beforeSend` for every event main sends, renderer ones included: tagged, scrubbed, and carrying
 *  the scrubbed tail of launch.log as an attachment. */
function beforeSend(event, hint) {
  // The SDK copies a renderer's scope tags onto main's, so main's own events are re-tagged here; a
  // renderer's event carries its own `service` and keeps it.
  if (event.tags?.['event.process'] !== 'renderer') {
    event.tags = { ...event.tags, ...sentryPolicy.tags('electron') };
  }
  return withScrubEnv(() => {
    const scrubbed = sentryPolicy.scrub(event, hint);
    if (!scrubbed) return null;
    const tail = sentryPolicy.scrub({ extra: { log: logTail() } })?.extra.log;
    if (tail) {
      hint.attachments = [
        ...(hint.attachments ?? []),
        { filename: 'launch.log', data: tail, contentType: 'text/plain' },
      ];
    }
    return scrubbed;
  });
}

/** Run `fn` with the values the scrub reads from env set on `process.env`, then restore it: main
 *  holds the secret and the stored settings outside its env. Synchronous, so no spawn sees the swap. */
function withScrubEnv(fn) {
  const stored = store.serviceEnv();
  const values = { FASTSTUDY_SECRET: SECRET };
  for (const name of SCRUB_ENV) values[name] = stored[name];
  const saved = {};
  for (const [name, value] of Object.entries(values)) {
    saved[name] = process.env[name];
    if (value) process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function log(source, line) {
  logStream?.write(`[${source}] ${line}\n`);
  if (!app.isPackaged) console.log(`[${source}] ${line}`);
}

// Truncated per launch: the log is what a bug report carries, and one launch's four children are
// the whole story — appending would grow without bound across a machine's lifetime.
function openLog() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
  log('main', `FastStudy ${app.getVersion()} — electron ${process.versions.electron}`);
}

function exe(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

/** The four children in dependency order. `peerVar` is the env var later children get this one
 *  under; `bridgeKey` its name in `window.faststudy.urls`. cwd branches too — see docs/BOOT.md. */
function childSpecs() {
  const dev = !app.isPackaged;
  const services = path.join(process.resourcesPath, 'services', exe('services'));
  // Packaged, the Node services run on Electron's own binary as node — nothing else ships one.
  const node = (dir, entry) => {
    const staged = path.join(process.resourcesPath, dir);
    return dev
      ? { cwd: path.join(REPO_ROOT, 'downloader', dir), command: 'node', args: [entry] }
      : {
          cwd: staged,
          command: process.execPath,
          args: [path.join(staged, entry)],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        };
  };
  // Both Python services are the one frozen bundle, picked by argv[1], so both run out of its dir.
  const python = (dir, module, mode) =>
    dev
      ? { cwd: path.join(REPO_ROOT, dir), command: 'uv', args: ['run', 'python', module] }
      : { cwd: path.dirname(services), command: services, args: [mode] };
  return [
    {
      name: 'database',
      peerVar: 'DATABASE_URL',
      bridgeKey: 'database',
      ...python('database', 'database_main.py', 'database'),
    },
    {
      name: 'backend',
      peerVar: 'BACKEND_URL',
      bridgeKey: 'backend',
      ...python('backend', 'backend_main.py', 'backend'),
    },
    {
      name: 'auto',
      peerVar: 'AUTODL_URL',
      bridgeKey: 'autoDownloader',
      ...node('auto', 'app.js'),
    },
    {
      name: 'server',
      peerVar: null,
      bridgeKey: 'downloadServer',
      ...node('server', path.join('src', 'index.js')),
    },
  ];
}

/** The environment every child shares: the launch contract plus the stored settings, read from the
 *  store at each boot — a later change reaches a running service through its own `POST /config`. */
function sharedEnv() {
  const packaged = app.isPackaged
    ? {
        FASTSTUDY_BIN_DIR: path.join(process.resourcesPath, 'bin'),
        // The shipped LaTeX cache; its presence also makes tectonic render `--only-cached`.
        TECTONIC_CACHE_DIR: path.join(process.resourcesPath, 'latex'),
      }
    : {};
  return {
    FASTSTUDY_PORT: '0',
    FASTSTUDY_SECRET: SECRET,
    FASTSTUDY_STATE_DIR: STATE_DIR,
    // What each service's Sentry init reads; `release` is `faststudy@<version>` in all five processes.
    FASTSTUDY_VERSION: app.getVersion(),
    SENTRY_ENVIRONMENT,
    ...sentryEnv(SENTRY_DSN),
    ...packaged,
    ...store.serviceEnv(),
  };
}

/** Push the launch screen's state to it. A no-op once the window has navigated to the app, which
 *  is the only other thing that ever loads in this window. */
function publishBoot() {
  mainWindow?.webContents.send('faststudy:boot', bootState);
}

function setService(name, patch) {
  Object.assign(
    bootState.services.find((service) => service.name === name),
    patch,
  );
  publishBoot();
}

// How a bundled binary fails to spawn once antivirus has quarantined it (gone) or is still scanning it.
const QUARANTINE_CODES = new Set(['ENOENT', 'UNKNOWN', 'EPERM', 'EACCES']);

/** The launch screen's error for a child that could not be spawned; the raw error goes to the log. */
function spawnFailure(spec, error) {
  log(spec.name, `spawn failed: ${error.stack ?? error.message}`);
  const bundled =
    app.isPackaged &&
    process.platform === 'win32' &&
    spec.command.startsWith(process.resourcesPath + path.sep) &&
    QUARANTINE_CODES.has(error.code);
  if (!bundled) return new Error(`${spec.name} could not start: ${error.message}`);
  const file = path.basename(spec.command);
  return new Error(
    `Your antivirus probably quarantined FastStudy's ${file}, so the app cannot start.\n\n` +
      `Open Windows Security → Virus & threat protection → Protection history, find ${file}, ` +
      `and choose Restore or Allow. Then click Try again.\n\n` +
      `If it is not listed there, reinstall FastStudy.`,
  );
}

/** Spawn one child and resolve the port it reports on stdout. */
function startChild(spec, env) {
  let child;
  try {
    child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so the kill on quit reaches the tools it spawned (ffmpeg, chrome)
      // and not just the service. Windows has no groups; `taskkill /T` is the equivalent there.
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
  } catch (error) {
    // Node throws, rather than emitting 'error', for spawn codes outside a short list — UNKNOWN among them.
    return Promise.reject(spawnFailure(spec, error));
  }
  children.push(child);
  return new Promise((resolve, reject) => {
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      log(spec.name, line);
      const match = PORT_LINE.exec(line);
      // The service listens before printing, so connecting the instant this arrives is safe.
      if (match) resolve(Number(match[1]));
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => log(spec.name, line));
    child.on('error', (error) => reject(spawnFailure(spec, error)));
    child.on('exit', (code, signal) => {
      log(spec.name, `exited (${code ?? signal})`);
      // Ignored once the port has arrived — a resolved promise cannot reject.
      reject(new Error(`${spec.name} exited (${code ?? signal}) before reporting its port`));
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until a child answers `/health`, the one route exempt from the secret check. Polled
 *  because a booting child has no channel back to main: its stdout carries the port line alone. */
async function waitForHealth(spec, url) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return await response.json();
    } catch {
      // Not yet serving; the child is alive or its exit already rejected the boot.
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${spec.name} did not answer ${url}/health within ${HEALTH_TIMEOUT_MS / 1000}s`,
      );
    }
    await delay(150);
  }
}

/** Start all four in dependency order, handing each the peers already running — plain env vars,
 *  valid only while the call graph stays acyclic (docs/BOOT.md). */
async function boot() {
  const specs = childSpecs();
  bootState = {
    services: specs.map((spec) => ({ name: spec.name, state: 'pending' })),
    error: null,
    update: null,
    logFile: LOG_FILE,
  };
  publishBoot();
  const shared = sharedEnv();
  const peers = {};
  const urls = {};
  for (const spec of specs) {
    setService(spec.name, { state: 'starting' });
    const port = await startChild(spec, { ...shared, ...peers });
    const url = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(spec, url);
    log('main', `${spec.name} ready on ${url} — ${JSON.stringify(health)}`);
    // The boot-time tool probe, which the launch screen renders: a service is ready with a missing
    // binary, and that costs one feature rather than the launch.
    setService(spec.name, { state: 'ready', tools: health.tools ?? null });
    urls[spec.bridgeKey] = url;
    if (spec.peerVar) peers[spec.peerVar] = url;
  }
  return urls;
}

/** Boot, then swap the launch screen for the app. A failure stays on the launch screen with the
 *  reason on the child that did not come up, and Try again re-runs this from a clean slate. */
async function runBoot() {
  if (booting) return;
  booting = true;
  try {
    serviceUrls = await boot();
    // The site root, never `/index.html`: the router matches on the path, and `/index.html` is not
    // one of its routes, so the app would mount and render nothing once the wall is behind it.
    mainWindow.loadURL(`${APP_ORIGIN}/`);
    // After the window navigates, never before, so it stays off the path that decides whether the
    // app comes up — see docs/UPDATES.md.
    startUpdater(log);
  } catch (error) {
    log('main', `boot failed: ${error.stack ?? error.message}`);
    // A retry re-spawns all four, so a surviving child would hold a port and a second DATA_ROOT writer.
    await stopChildren();
    const failing = bootState.services.find((service) => service.state === 'starting');
    // Nothing is running any more, so no row may still read ready.
    for (const service of bootState.services) {
      service.state = service === failing ? 'failed' : 'pending';
      service.tools = null;
    }
    bootState.error = error.message;
    bootState.update = null;
    publishBoot();
    // The one visible update surface: a failed boot may be a bad install the next release fixes.
    // `error` guards the listener from a later successful retry, whose launch must stay silent.
    startUpdater(log, (phase) => {
      if (!bootState.error) return;
      bootState.update = phase;
      publishBoot();
    });
  } finally {
    booting = false;
  }
}

/** SIGTERM every child now — synchronous, for `process.on('exit')`, which cannot wait. Idempotent:
 *  the list is emptied as it goes. Returns the children still to reap. */
function killChildren() {
  return signalChildren(children.splice(0));
}

/** Stop every child and resolve once each is gone, SIGKILLed if it outlived the grace. */
function stopChildren() {
  const signalled = killChildren();
  if (signalled.length) {
    const pending = reapChildren(signalled, KILL_GRACE_MS, (line) => log('main', line)).finally(
      () => reaping.delete(pending),
    );
    reaping.add(pending);
  }
  return Promise.all(reaping);
}

/** Open one DATA_ROOT file in the user's own app. Identifiers in, `database/` resolves the path —
 *  no open-any-file primitive for the renderer (docs/RENDERER.md). No `lecture`: an overview file. */
async function openDataFile({ course, lecture, name, kind }) {
  if (!serviceUrls.database) return { ok: false, error: 'the database service is not running' };
  const q = encodeURIComponent;
  const route = lecture
    ? `/courses/${q(course)}/lectures/${q(lecture)}/files/${q(name)}/path?kind=${q(kind ?? 'lecture')}`
    : `/courses/${q(course)}/overview/files/${q(name)}/path`;
  try {
    const response = await fetch(`${serviceUrls.database}${route}`, {
      headers: { 'X-FastStudy-Secret': SECRET },
    });
    if (!response.ok) return { ok: false, error: `database answered ${response.status}` };
    const { path: filePath } = await response.json();
    // openPath answers the empty string on success and the OS's reason otherwise — it never throws.
    const failure = await shell.openPath(filePath);
    return failure ? { ok: false, error: failure } : { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** Open a link in the user's browser. http(s) only: `openExternal` launches whatever handler a
 *  scheme is registered to, so an unchecked scheme is a way to start a program from a renderer. */
async function openExternalUrl(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, error: `not a URL: ${target}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `refused scheme: ${parsed.protocol}` };
  }
  try {
    await shell.openExternal(parsed.href);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** The tail of this launch's log, attached to every Sentry event. `launch.log` is main's to read: it
 *  sits outside `DATA_ROOT` and the renderer has no path to it. */
function logTail() {
  try {
    const { size } = fs.statSync(LOG_FILE);
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const fd = fs.openSync(LOG_FILE, 'r');
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return (start ? '…\n' : '') + buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return `(could not read ${LOG_FILE}: ${error.message})`;
  }
}

/** The OS folder dialog for the data-folder field: the chosen absolute path, or `null` if canceled.
 *  Creates and validates nothing — the frontend and `database/` guard the path on save. */
async function pickFolder(sender, defaultPath) {
  const options = { properties: ['openDirectory', 'createDirectory'] };
  if (typeof defaultPath === 'string' && defaultPath !== '') options.defaultPath = defaultPath;
  const { canceled, filePaths } = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(sender),
    options,
  );
  return canceled || filePaths.length === 0 ? null : filePaths[0];
}

/** The one window of the app: it opens on the launch screen and later navigates to the frontend.
 *  Created before anything is spawned, so the four process starts have something on screen. */
function createWindow(checks) {
  // Drops the default File/Edit/View bar, and with it its Ctrl+R / Ctrl+Shift+I / zoom accelerators.
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The app's bridge; the URLs are filled in by the time the window navigates to the frontend.
  ipcMain.on('faststudy:config', (event) => {
    event.returnValue = {
      urls: serviceUrls,
      secret: SECRET,
      checks,
      version: app.getVersion(),
      locale: app.getLocale(),
      defaultDataRoot: DEFAULT_DATA_ROOT,
      errorReports: reportsOn(),
    };
  });
  ipcMain.handle('faststudy:open-file', (event, target) => openDataFile(target));
  ipcMain.handle('faststudy:open-external', (event, url) => openExternalUrl(url));
  ipcMain.handle('faststudy:pick-folder', (event, defaultPath) =>
    pickFolder(event.sender, defaultPath),
  );
  ipcMain.handle('faststudy:settings-read', () => store.read());
  ipcMain.handle('faststudy:settings-write', (event, patch) =>
    writeSettings(patch, {
      urls: serviceUrls,
      secret: SECRET,
      setReporting: sentryPolicy.setReporting,
      log,
    }),
  );
  ipcMain.handle('faststudy:boot-state', () => bootState);
  ipcMain.on('faststudy:boot-retry', () => runBoot());
  ipcMain.on('faststudy:boot-quit', () => app.quit());
  // Denied, or the child would inherit the preload and so the secret (docs/RENDERER.md). The log
  // line is how a `target="_blank"` link that skipped `open.ts` shows up at all.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log('main', `denied window.open: ${url} — UI links must go through open.external`);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'boot.html'));
}

// A second launch would put two backends on one timing.db and two writers on one DATA_ROOT, so it
// hands focus to the running window instead.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  // Synchronous on Windows (`taskkill /F`), so `quit` — and a pending update install — still follows
  // the kill (docs/UPDATES.md); POSIX holds the quit until the reap is done, then quits again.
  app.on('will-quit', (event) => {
    const done = stopChildren();
    if (!reaping.size) return;
    event.preventDefault();
    done.finally(() => app.quit());
  });
  // The paths that skip `will-quit`; an orphaned service would keep writing DATA_ROOT (docs/BOOT.md).
  process.on('exit', killChildren);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => stopChildren().finally(() => process.exit(0)));
  }
  process.on('uncaughtException', (error) => {
    log('main', `uncaught: ${error.stack ?? error.message}`);
    // The SDK's own handler, registered first, has only queued the event; exiting now would drop it.
    Promise.allSettled([stopChildren(), sentry?.flush(2000)]).finally(() => process.exit(1));
  });

  app.whenReady().then(async () => {
    openLog();
    serveBundle();
    // Timed because they run inline in the boot path: a check that stops being cheap shows up here.
    const started = process.hrtime.bigint();
    const checks = runStartupChecks();
    const took = Number(process.hrtime.bigint() - started) / 1e6;
    log('main', `startup checks in ${took.toFixed(2)}ms — ${JSON.stringify(checks)}`);
    log('main', `error reports ${reportsOn() ? 'on' : 'off'} at launch`);
    createWindow(checks);
    // The frontend loads only once all four are healthy: it builds its service clients at module
    // scope, against URLs that do not exist until then.
    runBoot();
  });
}
