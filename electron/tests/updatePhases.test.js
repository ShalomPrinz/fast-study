const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { wirePhases } = require('../updatePhases');

function setup() {
  const emitter = new EventEmitter();
  const seen = [];
  const wired = wirePhases(emitter, (phase) => seen.push(phase));
  return { emitter, seen, wired };
}

test('an available update walks checking, downloading, downloaded', () => {
  const { emitter, seen } = setup();
  emitter.emit('checking-for-update');
  emitter.emit('update-available');
  emitter.emit('update-downloaded');
  assert.deepEqual(seen, ['checking', 'downloading', 'downloaded']);
});

test('no update ends on none', () => {
  const { emitter, seen } = setup();
  emitter.emit('checking-for-update');
  emitter.emit('update-not-available');
  assert.deepEqual(seen, ['checking', 'none']);
});

test('an error event and a rejected check report one error', () => {
  const { emitter, seen, wired } = setup();
  emitter.emit('checking-for-update');
  emitter.emit('error');
  wired.fail();
  assert.deepEqual(seen, ['checking', 'error']);
});

test('a late error never demotes a finished download', () => {
  const { emitter, seen, wired } = setup();
  emitter.emit('update-downloaded');
  emitter.emit('error');
  wired.fail();
  assert.deepEqual(seen, ['downloaded']);
});
