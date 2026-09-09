const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { app, BrowserWindow, ipcMain } = require('electron');
const { runStartupChecks } = require('./checks');
const { APP_ORIGIN, registerScheme, serveBundle } = require('./protocol');
const store = require('./store');

// Must run before the app is ready, or the scheme is registered too late to be privileged.
registerScheme();

const REPO_ROOT = path.resolve(__dirname, '..');
// One secret per launch, in every child's environment and in the renderer's bridge. 32 bytes of
// hex, not a uuid: the services compare it in constant time and never parse it.
const SECRET = randomBytes(32).toString('hex');
const PORT_LINE = /^FASTSTUDY_PORT=(\d+)$/;
const HEALTH_TIMEOUT_MS = 60_000;

// Per-user writable state: what `statePath`/`state_path` join onto in every service. Passed
// explicitly rather than left to their fallback, so main's log lands beside the children's state.
const STATE_DIR = app.isPackaged
  ? path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'FastStudy')
  : path.join(REPO_ROOT, '.state');

const LOG_FILE = path.join(STATE_DIR, 'logs', 'launch.log');

const children = [];
let logStream = null;
let mainWindow = null;
// The launch screen's whole model: one row per child plus the failure, if the boot hit one.
let bootState = null;
let booting = false;
let serviceUrls = {};

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

/** The four children in dependency order. `peerVar` is the env var this service is published to
 *  later children under; `bridgeKey` is its name in the renderer's `window.faststudy.urls`. */
function childSpecs() {
  const dev = !app.isPackaged;
  const services = path.join(process.resourcesPath, 'services', exe('services'));
  // Packaged, the Node services run on Electron's own binary as node — nothing else ships one, and
  // yt-dlp is pointed at that same execPath as its JS runtime.
  const node = (entry) =>
    dev
      ? { command: 'node', args: [entry] }
      : {
          command: process.execPath,
          args: [path.join(process.resourcesPath, entry)],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        };
  const python = (module, mode) =>
    dev ? { command: 'uv', args: ['run', 'python', module] } : { command: services, args: [mode] };
  return [
    {
      name: 'database',
      cwd: path.join(REPO_ROOT, 'database'),
      peerVar: 'DATABASE_URL',
      bridgeKey: 'database',
      ...python('database_main.py', 'database'),
    },
    {
      name: 'backend',
      cwd: path.join(REPO_ROOT, 'backend'),
      peerVar: 'BACKEND_URL',
      bridgeKey: 'backend',
      ...python('backend_main.py', 'backend'),
    },
    {
      name: 'auto',
      cwd: path.join(REPO_ROOT, 'downloader', 'auto'),
      peerVar: 'AUTODL_URL',
      bridgeKey: 'autoDownloader',
      ...node('app.js'),
    },
    {
      name: 'server',
      cwd: path.join(REPO_ROOT, 'downloader', 'server'),
      peerVar: null,
      bridgeKey: 'downloadServer',
      ...node(path.join('src', 'index.js')),
    },
  ];
}

/** The environment every child shares: the launch contract, plus the stored settings as the env
 *  vars each owning service already reads. A later settings change reaches a running service
 *  through its own `POST /config`, so this is read once, at boot. */
function sharedEnv() {
  const packaged = app.isPackaged
    ? {
        FASTSTUDY_BIN_DIR: path.join(process.resourcesPath, 'bin'),
        // The shipped, complete LaTeX cache — its presence is also what makes tectonic render
        // `--only-cached`, so an install can never fetch mid-render.
        TECTONIC_CACHE_DIR: path.join(process.resourcesPath, 'latex'),
      }
    : {};
  return {
    FASTSTUDY_PORT: '0',
    FASTSTUDY_SECRET: SECRET,
    FASTSTUDY_STATE_DIR: STATE_DIR,
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

/** Spawn one child and resolve the port it reports on stdout. */
function startChild(spec, env) {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so the kill on quit reaches the tools it spawned (ffmpeg, chrome)
    // and not just the service. Windows has no groups; `taskkill /T` is the equivalent there.
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      log(spec.name, line);
      const match = PORT_LINE.exec(line);
      // The service listens before printing, so connecting the instant this arrives is safe.
      if (match) resolve(Number(match[1]));
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => log(spec.name, line));
    child.on('error', (error) =>
      reject(new Error(`${spec.name} could not start: ${error.message}`)),
    );
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

/** Start all four in dependency order, handing each one the peers that are already running.
 *  Every peer is knowable before the service that calls it starts, which is what lets the whole
 *  handshake be plain env vars — see the service call graph in the root CLAUDE.md. */
async function boot() {
  const specs = childSpecs();
  bootState = {
    services: specs.map((spec) => ({ name: spec.name, state: 'pending' })),
    error: null,
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
  } catch (error) {
    log('main', `boot failed: ${error.stack ?? error.message}`);
    // Whatever came up before the failure is torn down: a retry re-spawns all four, and a surviving
    // child would hold a port and a second writer on DATA_ROOT.
    killChildren();
    const failing = bootState.services.find((service) => service.state === 'starting');
    // Nothing is running any more, so no row may still read ready — only the one that broke keeps a
    // state of its own.
    for (const service of bootState.services) {
      service.state = service === failing ? 'failed' : 'pending';
      service.tools = null;
    }
    bootState.error = error.message;
    publishBoot();
  } finally {
    booting = false;
  }
}

/** Stop every child. Idempotent — the list is emptied as it goes, so a retry and the exit handlers
 *  can all call it — and safe to call from a synchronous exit handler. */
function killChildren() {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } else {
        // Negative pid: the child's whole process group, which is why they are spawned detached.
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      // Already gone, which is the outcome we wanted.
    }
  }
}

/** The one window of the app: it opens on the launch screen and later navigates to the frontend.
 *  Created before anything is spawned, so the four process starts have something on screen. */
function createWindow(checks) {
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
  // The launch screen reads none of this; it is the app's bridge, and the URLs are filled in by the
  // time the window navigates there.
  ipcMain.on('faststudy:config', (event) => {
    event.returnValue = { urls: serviceUrls, secret: SECRET, checks };
  });
  ipcMain.handle('faststudy:settings-read', () => store.read());
  ipcMain.handle('faststudy:settings-write', (event, patch) => store.write(patch));
  ipcMain.handle('faststudy:boot-state', () => bootState);
  ipcMain.on('faststudy:boot-retry', () => runBoot());
  ipcMain.on('faststudy:boot-quit', () => app.quit());
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
  app.on('will-quit', killChildren);
  // The crash paths: an uncaught exception, a signal, and whatever else ends the process. None of
  // them run `will-quit`, and an orphaned service would keep writing DATA_ROOT after the app is gone.
  process.on('exit', killChildren);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      killChildren();
      process.exit(0);
    });
  }
  process.on('uncaughtException', (error) => {
    log('main', `uncaught: ${error.stack ?? error.message}`);
    killChildren();
    process.exit(1);
  });

  app.whenReady().then(async () => {
    openLog();
    serveBundle();
    // Timed in the log because these run inline in the boot path: a check that stops being cheap
    // shows up here rather than as a launch that quietly got slower.
    const started = process.hrtime.bigint();
    const checks = runStartupChecks();
    const took = Number(process.hrtime.bigint() - started) / 1e6;
    log('main', `startup checks in ${took.toFixed(2)}ms — ${JSON.stringify(checks)}`);
    createWindow(checks);
    // The window shows the launch screen while this runs, and navigates to the frontend only once
    // all four are healthy: a renderer that loaded first would build its service clients at module
    // scope against URLs that do not exist yet.
    runBoot();
  });
}
