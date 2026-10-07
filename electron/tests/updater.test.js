const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { app } = require('./stubElectron');

const HOUR = 60 * 60 * 1000;

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

test('the timer fires a recheck every 4 hours', async (t) => {
  const { fake, startUpdater, log } = load(t);
  startUpdater(log);
  assert.equal(fake.checks, 1);
  await flush();
  t.mock.timers.tick(4 * HOUR);
  assert.equal(fake.checks, 2);
  await flush();
  t.mock.timers.tick(4 * HOUR);
  assert.equal(fake.checks, 3);
});

test('a tick during a running check does not start another', async (t) => {
  const { fake, startUpdater, log } = load(t);
  let release;
  fake.next = () => new Promise((resolve) => (release = resolve));
  startUpdater(log);
  t.mock.timers.tick(4 * HOUR);
  assert.equal(fake.checks, 1);
  release();
  await flush();
  fake.next = () => Promise.resolve();
  t.mock.timers.tick(4 * HOUR);
  assert.equal(fake.checks, 2);
});

test('the timer stops once an update is downloaded', async (t) => {
  const { fake, startUpdater, log } = load(t);
  startUpdater(log);
  await flush();
  fake.emit('update-downloaded', { version: '9.9.9' });
  t.mock.timers.tick(8 * HOUR);
  assert.equal(fake.checks, 1);
});

test('a failed recheck is logged and leaves the phase alone', async (t) => {
  const { fake, startUpdater, log, lines, phases } = load(t);
  startUpdater(log, (p) => phases.push(p));
  fake.emit('update-not-available');
  await flush();
  fake.next = () => Promise.reject(new Error('offline'));
  t.mock.timers.tick(4 * HOUR);
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
  t.mock.timers.tick(4 * HOUR);
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
  assert.deepEqual(result, { ok: false, error: 'no update is downloaded' });
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
  assert.deepEqual(order, ['stopped', 'install true true']);
  assert.deepEqual(a, { ok: true });
  assert.equal(a, b);
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
  assert.deepEqual(result, { ok: false, error: 'no installer' });
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
  assert.deepEqual(result, { ok: false, error: 'kill failed' });
  assert.equal(recovered, true);
});
