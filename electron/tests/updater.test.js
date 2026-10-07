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
  const { startUpdater } = require('../updater');
  const lines = [];
  const phases = [];
  return { fake, startUpdater, lines, phases, log: (s, l) => lines.push(l) };
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
