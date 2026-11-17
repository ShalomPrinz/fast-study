const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app } = require('./stubElectron');
const pending = require('../macPending');

const MINUTE = 60 * 1000;

// `updater.js` keeps module state (`started`), so each test loads a fresh copy over a fake autoUpdater.
function load(t) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  app.isPackaged = true;
  t.after(() => {
    app.isPackaged = false;
  });
  const fake = new EventEmitter();
  fake.checks = 0;
  fake.checkForUpdates = () => {
    fake.checks += 1;
    return fake.next();
  };
  fake.next = () => Promise.resolve();
  const lib = require.resolve('electron-updater');
  require.cache[lib] = { id: lib, filename: lib, loaded: true, exports: { autoUpdater: fake } };
  delete require.cache[require.resolve('../updater')];
  const updater = require('../updater');
  const lines = [];
  const phases = [];
  const shown = [];
  updater.onUpdateState((state) => shown.push(state));
  return { fake, ...updater, lines, phases, shown, log: (s, l) => lines.push(l) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the timer fires a recheck every 30 minutes', async (t) => {
  const { fake, startUpdater, log } = load(t);
  startUpdater(log);
  assert.equal(fake.checks, 1);
  await flush();
  t.mock.timers.tick(30 * MINUTE);
  assert.equal(fake.checks, 2);
  await flush();
  t.mock.timers.tick(30 * MINUTE);
  assert.equal(fake.checks, 3);
});

test('a tick during a running check does not start another', async (t) => {
  const { fake, startUpdater, log } = load(t);
  let release;
  fake.next = () => new Promise((resolve) => (release = resolve));
  startUpdater(log);
  t.mock.timers.tick(30 * MINUTE);
  assert.equal(fake.checks, 1);
  release();
  await flush();
  fake.next = () => Promise.resolve();
  t.mock.timers.tick(30 * MINUTE);
  assert.equal(fake.checks, 2);
});

test('a tick while downloading is skipped, and a failed download is retried', async (t) => {
  const { fake, startUpdater, log } = load(t);
  startUpdater(log);
  await flush();
  fake.emit('update-available');
  t.mock.timers.tick(30 * MINUTE);
  assert.equal(fake.checks, 1);
  fake.emit('error', new Error('download failed'));
  t.mock.timers.tick(30 * MINUTE);
  assert.equal(fake.checks, 2);
});

test('the timer stops once an update is downloaded', async (t) => {
  const { fake, startUpdater, log } = load(t);
  startUpdater(log);
  await flush();
  fake.emit('update-downloaded', { version: '9.9.9' });
  t.mock.timers.tick(60 * MINUTE);
  assert.equal(fake.checks, 1);
});

test('a failed recheck is logged and leaves the phase alone', async (t) => {
  const { fake, startUpdater, log, lines, phases } = load(t);
  startUpdater(log, (p) => phases.push(p));
  fake.emit('update-not-available');
  await flush();
  fake.next = () => Promise.reject(new Error('offline'));
  t.mock.timers.tick(30 * MINUTE);
  fake.emit('checking-for-update');
  fake.emit('error', new Error('offline'));
  await flush();
  assert.ok(lines.includes('check failed: offline'));
  assert.deepEqual(phases, ['none']);
});

test('a failed launch check still reports the error phase', async (t) => {
  const { fake, startUpdater, log, phases } = load(t);
  fake.next = () => Promise.reject(new Error('offline'));
  startUpdater(log, (p) => phases.push(p));
  await flush();
  assert.deepEqual(phases, ['error']);
});

test('the app window sees every check, rechecks included, and only its two phases', async (t) => {
  const { fake, startUpdater, updateState, log, phases, shown } = load(t);
  startUpdater(log, (p) => phases.push(p));
  fake.emit('checking-for-update');
  fake.emit('update-not-available');
  await flush();
  t.mock.timers.tick(30 * MINUTE);
  fake.emit('checking-for-update');
  fake.emit('update-available');
  fake.emit('update-downloaded', { version: '9.9.9' });
  assert.deepEqual(phases, ['checking', 'none']);
  assert.deepEqual(shown, ['downloading', 'downloaded']);
  assert.equal(updateState(), 'downloaded');
});

test('restart refuses before an update is downloaded', async (t) => {
  const { fake, startUpdater, restartToUpdate, log } = load(t);
  let stopped = false;
  fake.quitAndInstall = () => assert.fail('installed');
  startUpdater(log);
  fake.emit('update-available');
  const result = await restartToUpdate(
    async () => (stopped = true),
    () => assert.fail('recovered'),
    log,
  );
  assert.deepEqual(result, { error: 'no update is downloaded' });
  assert.equal(stopped, false);
});

test('restart stops the services before it installs, once for two clicks', async (t) => {
  const { fake, startUpdater, restartToUpdate, log } = load(t);
  const order = [];
  fake.quitAndInstall = (silent, run) => order.push(`install ${silent} ${run}`);
  startUpdater(log);
  fake.emit('update-downloaded', { version: '9.9.9' });
  const stop = async () => {
    await flush();
    order.push('stopped');
  };
  const never = () => assert.fail('recovered');
  const [a, b] = await Promise.all([
    restartToUpdate(stop, never, log),
    restartToUpdate(stop, never, log),
  ]);
  assert.deepEqual(order, ['stopped', 'install false true']);
  assert.equal(a, undefined);
  assert.equal(b, undefined);
});

test('a failed install reboots, keeps Restart offered, and allows another try', async (t) => {
  const { fake, startUpdater, restartToUpdate, updateState, log, lines } = load(t);
  let installs = 0;
  fake.quitAndInstall = () => {
    installs += 1;
    fake.emit('error', new Error('no installer'));
  };
  let recovered = 0;
  startUpdater(log);
  fake.emit('update-downloaded', { version: '9.9.9' });
  const result = await restartToUpdate(
    async () => {},
    () => (recovered += 1),
    log,
  );
  assert.deepEqual(result, { error: 'no installer' });
  assert.ok(lines.includes('restart failed: no installer'));
  assert.equal(recovered, 1);
  assert.equal(updateState(), 'downloaded');
  // A rebooted launch calls `startUpdater` again; the guard keeps it to one check.
  startUpdater(log);
  assert.equal(fake.checks, 1);
  await restartToUpdate(
    async () => {},
    () => (recovered += 1),
    log,
  );
  assert.equal(installs, 2);
});

test('a kill that throws also reboots', async (t) => {
  const { fake, startUpdater, restartToUpdate, log } = load(t);
  fake.quitAndInstall = () => assert.fail('installed');
  let recovered = false;
  startUpdater(log);
  fake.emit('update-downloaded', { version: '9.9.9' });
  const stop = async () => {
    throw new Error('kill failed');
  };
  const result = await restartToUpdate(stop, () => (recovered = true), log);
  assert.deepEqual(result, { error: 'kill failed' });
  assert.equal(recovered, true);
});

test('a failed auto-download does not surface as an unhandled rejection', async (t) => {
  const { fake, startUpdater, log } = load(t);
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  fake.next = () =>
    Promise.resolve({
      downloadPromise: Promise.reject(new Error('net::ERR_NETWORK_IO_SUSPENDED')),
    });
  startUpdater(log);
  await flush();
  await flush();
  assert.deepEqual(unhandled, []);
});

// The macOS install step: the same fake autoUpdater, a fake `macUpdate`, and `process.platform` held
// at `platform` while `updater.js` loads, since it reads the platform once. The state root is real:
// `<root>/state`, with the bundle in `<root>/Applications`.
function loadMac(t, stage, platform = 'darwin') {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...real, value: platform });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-updater-'));
  const state = path.join(root, 'state');
  const dir = path.join(state, 'update');
  const stagedApp = path.join(dir, 'staged', 'FastStudy.app');
  fs.mkdirSync(path.join(root, 'Applications'));
  const mac = {
    root,
    state,
    dir,
    stagedApp,
    bundle: path.join(root, 'Applications', 'FastStudy.app'),
    staged: [],
    helpers: [],
    quits: 0,
    onQuit: [],
  };
  const lib = require.resolve('../macUpdate');
  require.cache[lib] = {
    id: lib,
    filename: lib,
    loaded: true,
    exports: {
      bundlePath: () => mac.bundle,
      stageUpdate: (options) => {
        mac.staged.push(options);
        return stage ? stage() : stagedApp;
      },
      launchHelper: (options) => {
        mac.helpers.push(options);
        if (mac.helperError) throw mac.helperError;
        return 4242;
      },
    },
  };
  app.once = (event, listener) => event === 'quit' && mac.onQuit.push(listener);
  app.quit = () => (mac.quits += 1);
  app.getVersion = () => '1.0.0';
  t.after(() => {
    Object.defineProperty(process, 'platform', real);
    delete require.cache[lib];
    delete app.once;
    delete app.quit;
    delete app.getVersion;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const loaded = load(t);
  const { fake } = loaded;
  fake.updateInfoAndProvider = { provider: { resolveFiles: (info) => info.files } };
  fake.downloadUpdate = () => assert.fail('electron-updater downloaded');
  fake.quitAndInstall = () => assert.fail('electron-updater installed');
  const info = { version: '9.9.9', files: ['the zip'] };
  fake.next = async () => {
    fake.emit('update-available', info);
    return { isUpdateAvailable: true, updateInfo: info, downloadPromise: null };
  };
  /** Stage a build on disk as an earlier run left it, with its record in `state`. */
  const leave = async (record = {}) => {
    fs.mkdirSync(stagedApp, { recursive: true });
    fs.writeFileSync(path.join(stagedApp, 'build'), 'new');
    const digest = await pending.treeDigest(stagedApp);
    pending.write(dir, {
      version: '9.9.9',
      app: 'FastStudy.app',
      digest,
      state: 'pending',
      ...record,
    });
  };
  return { ...loaded, mac, leave };
}

test('macOS stages the update itself and a plain quit installs nothing', async (t) => {
  const { fake, startUpdater, updateState, log, lines, shown, mac } = loadMac(t);
  startUpdater(log, null, mac.state);
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, false);
  await flush();
  assert.deepEqual(mac.staged, [
    { files: ['the zip'], version: '9.9.9', dir: mac.dir, bundle: mac.bundle },
  ]);
  assert.deepEqual(shown, ['downloading', 'downloaded']);
  assert.equal(updateState(), 'downloaded');
  assert.ok(
    lines.includes('version 9.9.9 downloaded — it installs at the next launch, or on Restart now'),
  );
  t.mock.timers.tick(60 * MINUTE);
  assert.equal(fake.checks, 1);
  // No `quit` hook exists until Restart now, so a plain quit spawns no helper and decrypts no key.
  assert.deepEqual(mac.onQuit, []);
  assert.deepEqual(mac.helpers, []);
});

test('Windows leaves the quit-time install to electron-updater and never touches the helper', async (t) => {
  const { fake, startUpdater, restartToUpdate, log, lines, mac } = loadMac(t, null, 'win32');
  const installs = [];
  fake.quitAndInstall = (silent, run) => installs.push([silent, run]);
  fake.next = async () => ({ isUpdateAvailable: true, updateInfo: { version: '9.9.9' } });
  startUpdater(log, null, mac.state);
  assert.equal(fake.autoDownload, true);
  assert.equal(fake.autoInstallOnAppQuit, true);
  await flush();
  fake.emit('update-downloaded', { version: '9.9.9' });
  assert.ok(lines.includes('version 9.9.9 downloaded — it installs when the app quits'));
  await restartToUpdate(
    async () => {},
    () => assert.fail('recovered'),
    log,
  );
  assert.deepEqual(installs, [[false, true]]);
  assert.deepEqual([mac.staged, mac.helpers, mac.onQuit, mac.quits], [[], [], [], 0]);
});

test('macOS Restart now stops the services, then quits into a relaunching install', async (t) => {
  const { startUpdater, restartToUpdate, log, mac, leave } = loadMac(t);
  await leave();
  startUpdater(log, null, mac.state);
  await flush();
  const order = [];
  const result = await restartToUpdate(
    async () => order.push(`stopped, ${mac.quits} quits`),
    () => assert.fail('recovered'),
    log,
  );
  assert.equal(result, undefined);
  assert.deepEqual(order, ['stopped, 0 quits']);
  assert.equal(mac.quits, 1);
  // Nothing is installed until the app's `quit`, which follows the `will-quit` kill.
  assert.deepEqual(mac.helpers, []);
  mac.onQuit[0]();
  assert.deepEqual(mac.helpers, [
    {
      pid: process.pid,
      bundle: mac.bundle,
      staged: mac.stagedApp,
      logFile: path.join(mac.state, 'logs', 'update.log'),
      // No settings file here: the update still goes on, carrying an empty handoff.
      handoff: '{"secrets":{}}',
    },
  ]);
  // The helper may not land: the record stays `attempted`, so the reopened build fails the version.
  assert.equal(pending.read(mac.dir).state, 'attempted');
});

test('macOS Restart now marks the version attempted before it stops the services', async (t) => {
  const { startUpdater, restartToUpdate, log, mac, leave } = loadMac(t);
  await leave();
  startUpdater(log, null, mac.state);
  await flush();
  let seen = null;
  await restartToUpdate(
    async () => (seen = pending.read(mac.dir).state),
    () => assert.fail('recovered'),
    log,
  );
  assert.equal(seen, 'attempted');
});

test('macOS Restart now with a changed staged build fails the version and keeps the services running', async (t) => {
  const { startUpdater, restartToUpdate, onUpdateState, updateState, log, lines, mac, leave } =
    loadMac(t);
  await leave();
  startUpdater(log, null, mac.state);
  await flush();
  fs.writeFileSync(path.join(mac.stagedApp, 'build'), 'tampered');
  const pushed = [];
  onUpdateState((state) => pushed.push(state));
  const result = await restartToUpdate(
    async () => assert.fail('stopped the services'),
    () => assert.fail('recovered'),
    log,
  );
  assert.deepEqual(result, { error: 'the staged build changed on disk after it was downloaded' });
  assert.equal(mac.quits, 0);
  assert.deepEqual(mac.onQuit, []);
  assert.equal(pending.read(mac.dir).state, 'failed');
  assert.deepEqual(pushed, [null]);
  assert.equal(updateState(), null);
  assert.ok(lines.some((line) => line.includes('is not tried again')));
});

test('macOS Restart now whose kill throws leaves the record pending and a retry proceeds', async (t) => {
  const { startUpdater, restartToUpdate, log, mac, leave } = loadMac(t);
  await leave();
  startUpdater(log, null, mac.state);
  await flush();
  let recovered = 0;
  const first = await restartToUpdate(
    async () => {
      throw new Error('kill failed');
    },
    () => recovered++,
    log,
  );
  assert.deepEqual(first, { error: 'kill failed' });
  assert.equal(recovered, 1);
  assert.equal(pending.read(mac.dir).state, 'pending');
  const second = await restartToUpdate(
    async () => {},
    () => assert.fail('recovered'),
    log,
  );
  assert.equal(second, undefined);
  assert.equal(mac.quits, 1);
  assert.equal(pending.read(mac.dir).state, 'attempted');
});

test('macOS Restart now whose helper cannot start fails the version', async (t) => {
  const { startUpdater, restartToUpdate, log, mac, leave } = loadMac(t);
  await leave();
  startUpdater(log, null, mac.state);
  await flush();
  mac.helperError = new Error('spawn failed');
  await restartToUpdate(
    async () => {},
    () => assert.fail('recovered'),
    log,
  );
  mac.onQuit[0]();
  const record = pending.read(mac.dir);
  assert.deepEqual([record.state, record.version], ['failed', '9.9.9']);
});

test('macOS Restart now hands the stored keys to the helper in plaintext', async (t) => {
  const stub = require('./stubElectron');
  stub.useTempUserData();
  t.after(() => stub.cleanup());
  require('../store').write({ geminiApiKey: 'gemini-secret' });
  const { startUpdater, restartToUpdate, log, mac, leave } = loadMac(t);
  await leave();
  startUpdater(log, null, mac.state);
  await flush();
  await restartToUpdate(
    async () => {},
    () => assert.fail('recovered'),
    log,
  );
  mac.onQuit[0]();
  assert.equal(mac.helpers[0].handoff, '{"secrets":{"gemini_api_key":"gemini-secret"}}');
});

test('macOS Restart now installs with no handoff when a stored key will not decrypt', async (t) => {
  const stub = require('./stubElectron');
  stub.useTempUserData();
  t.after(() => stub.cleanup());
  require('../store').write({ geminiApiKey: 'gemini-secret' });
  stub.safeStorage.decryptString = () => {
    throw new Error('denied');
  };
  const { startUpdater, restartToUpdate, log, lines, mac, leave } = loadMac(t);
  await leave();
  startUpdater(log, null, mac.state);
  await flush();
  await restartToUpdate(
    async () => {},
    () => assert.fail('recovered'),
    log,
  );
  mac.onQuit[0]();
  assert.equal(mac.helpers[0].handoff, null);
  assert.ok(lines.some((line) => line.includes('installing without a key handoff')));
});

test('a macOS download that fails is the error phase, and the next tick retries it', async (t) => {
  let fail = true;
  const stage = async () => {
    if (fail) throw new Error('sha512 mismatch');
    return '/state/update/staged/FastStudy.app';
  };
  const { fake, startUpdater, updateState, log, lines, phases, mac } = loadMac(t, stage);
  startUpdater(log, (p) => phases.push(p), mac.state);
  await flush();
  assert.deepEqual(phases, ['downloading', 'error']);
  assert.ok(lines.includes('error: sha512 mismatch'));
  assert.equal(updateState(), null);
  fail = false;
  t.mock.timers.tick(30 * MINUTE);
  await flush();
  assert.equal(fake.checks, 2);
  assert.equal(updateState(), 'downloaded');
});

test('a launch with nothing pending installs nothing and says nothing', async (t) => {
  const { installPending, log, lines, mac } = loadMac(t);
  assert.equal(await installPending(mac.state, log), false);
  assert.deepEqual([mac.helpers, lines], [[], []]);
});

test('a launch installs a verified pending update with the keys, and a second launch starts no second swap', async (t) => {
  const stub = require('./stubElectron');
  stub.useTempUserData();
  t.after(() => stub.cleanup());
  require('../store').write({ groqApiKey: 'groq-secret' });
  const { installPending, log, lines, mac, leave } = loadMac(t);
  await leave();
  assert.equal(await installPending(mac.state, log), true);
  assert.deepEqual(mac.helpers, [
    {
      pid: process.pid,
      bundle: mac.bundle,
      staged: mac.stagedApp,
      logFile: path.join(mac.state, 'logs', 'update.log'),
      handoff: '{"secrets":{"groq_api_key":"groq-secret"}}',
    },
  ]);
  assert.match(lines[0], /^version 9\.9\.9 verified in \d+ms — installing it before this launch$/);
  assert.match(lines[1], /^install helper started \(pid 4242\)/);
  assert.equal(pending.read(mac.dir).state, 'attempted');
  // The same build launched again — a second instance, or the old build reopened after a failed swap.
  assert.equal(await installPending(mac.state, log), false);
  assert.equal(mac.helpers.length, 1);
  assert.equal(
    lines.at(-1),
    'version 9.9.9 did not install at the last launch and is not tried again — see logs/update.log',
  );
  assert.equal(pending.read(mac.dir).state, 'failed');
  assert.equal(fs.existsSync(mac.stagedApp), false);
});

test('a pending update no newer than the running build is discarded', async (t) => {
  const { installPending, log, lines, mac, leave } = loadMac(t);
  for (const record of [
    { version: '1.0.0' },
    { version: '0.9.4' },
    { state: 'attempted', version: '1.0.0' },
  ]) {
    await leave(record);
    assert.equal(await installPending(mac.state, log), false);
    assert.equal(fs.existsSync(mac.dir), false);
    assert.equal(
      lines.at(-1),
      `pending update cleared: ${record.version} is not newer than this build`,
    );
  }
  assert.deepEqual(mac.helpers, []);
});

test('a staged build that changed on disk is not installed, and the old build boots', async (t) => {
  const { installPending, log, lines, mac, leave } = loadMac(t);
  await leave();
  fs.writeFileSync(path.join(mac.stagedApp, 'build'), 'tampered');
  assert.equal(await installPending(mac.state, log), false);
  assert.deepEqual(mac.helpers, []);
  assert.equal(
    lines.at(-1),
    'version 9.9.9 not installed and not tried again: the staged build changed on disk after it was downloaded',
  );
  assert.deepEqual(pending.read(mac.dir), {
    version: '9.9.9',
    state: 'failed',
    reason: 'the staged build changed on disk after it was downloaded',
  });
  assert.equal(fs.existsSync(mac.stagedApp), false);
});

test('a helper that cannot start fails the pending update rather than the launch', async (t) => {
  const { installPending, log, lines, mac, leave } = loadMac(t);
  await leave();
  mac.helperError = new Error('spawn /bin/sh EAGAIN');
  assert.equal(await installPending(mac.state, log), false);
  assert.equal(
    lines.at(-1),
    'version 9.9.9 not installed and not tried again: spawn /bin/sh EAGAIN',
  );
  assert.equal(pending.read(mac.dir).state, 'failed');
});

test('a bundle in a read-only folder leaves the update pending', async (t) => {
  const { installPending, log, lines, mac, leave } = loadMac(t);
  await leave();
  mac.bundle = path.join(mac.root, 'missing', 'FastStudy.app');
  assert.equal(await installPending(mac.state, log), false);
  assert.deepEqual(mac.helpers, []);
  assert.match(lines.at(-1), /^version 9\.9\.9 stays pending: .* is not writable$/);
  assert.equal(pending.read(mac.dir).state, 'pending');
});

test('a version that failed its launch-time install is not downloaded again, and a newer one is', async (t) => {
  const { fake, startUpdater, updateState, log, lines, phases, mac } = loadMac(t);
  pending.fail(mac.dir, '9.9.9', 'its install at an earlier launch did not complete');
  startUpdater(log, (p) => phases.push(p), mac.state);
  await flush();
  assert.deepEqual(mac.staged, []);
  assert.deepEqual(phases, ['downloading', 'none']);
  assert.equal(updateState(), null);
  assert.ok(
    lines.includes(
      'version 9.9.9 is not downloaded again: its install at an earlier launch did not complete',
    ),
  );
  const newer = { version: '9.9.10', files: ['the zip'] };
  fake.next = async () => ({ isUpdateAvailable: true, updateInfo: newer });
  t.mock.timers.tick(30 * MINUTE);
  await flush();
  assert.equal(mac.staged.length, 1);
  assert.equal(mac.staged[0].version, '9.9.10');
  assert.equal(updateState(), 'downloaded');
});
