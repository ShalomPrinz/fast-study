const assert = require('node:assert/strict');
const fs = require('node:fs');
const { afterEach, beforeEach, test } = require('node:test');

const stub = require('./stubElectron');
const windowState = require('../windowState');

beforeEach(() => stub.useTempUserData());
afterEach(() => stub.cleanup());

const fullHd = { x: 0, y: 0, width: 1920, height: 1040 };

test('a saved size and maximized flag inside the work area come back unchanged', () => {
  assert.deepEqual(
    windowState.restoredSize({ width: 1600, height: 950, maximized: true }, fullHd),
    {
      width: 1600,
      height: 950,
      maximized: true,
    },
  );
});

test('missing or corrupt state falls back to 1400x900, not maximized', () => {
  const fallback = { width: 1400, height: 900, maximized: false };
  for (const saved of [null, undefined, 'junk', 42, {}, { width: 'wide', height: NaN }]) {
    assert.deepEqual(windowState.restoredSize(saved, fullHd), fallback, JSON.stringify(saved));
  }
  assert.equal(windowState.restoredSize({ maximized: 'yes' }, fullHd).maximized, false);
});

test('a size saved on a bigger monitor is clamped to the work area', () => {
  const laptop = { x: 0, y: 0, width: 1366, height: 728 };
  assert.deepEqual(windowState.restoredSize({ width: 2500, height: 1400 }, laptop), {
    width: 1366,
    height: 728,
    maximized: false,
  });
});

test('a size below the minimum is raised to it, and the minimum is capped by the work area', () => {
  assert.deepEqual(windowState.restoredSize({ width: 300, height: 200 }, fullHd), {
    width: 1024,
    height: 640,
    maximized: false,
  });
  const tiny = { x: 0, y: 0, width: 800, height: 600 };
  assert.deepEqual(windowState.minimumSize(tiny), { width: 800, height: 600 });
  assert.deepEqual(windowState.restoredSize({ width: 300, height: 200 }, tiny), {
    width: 800,
    height: 600,
    maximized: false,
  });
});

test('save then load round-trips, and an unparseable file loads as null', () => {
  assert.equal(windowState.load(), null);
  windowState.save({ width: 1500, height: 800, maximized: true });
  assert.deepEqual(windowState.load(), { width: 1500, height: 800, maximized: true });
  fs.writeFileSync(windowState.file(), '{not json');
  assert.equal(windowState.load(), null);
});
