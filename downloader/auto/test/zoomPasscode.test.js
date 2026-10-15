// The zoom passcode gate's retry budget, driven through a stub page.
import test, { mock } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { ZoomExtractor } from '../src/extractors/ZoomExtractor.js';
import { PasscodeError } from '../src/lib/errors.js';

// A page whose passcode gate shows and never detaches; counts fill+click submits.
function stuckGatePage() {
  const page = {
    fills: 0,
    clicks: 0,
    waitForRequest: () => new Promise(() => {}),
    goto: async () => {},
    isVisible: async () => false,
    waitForSelector: async (_sel, opts = {}) => {
      if (opts.state === 'detached') throw new Error('timeout');
      return {};
    },
    fill: async () => {
      page.fills++;
    },
    click: async () => {
      page.clicks++;
    },
  };
  return page;
}

test('a gate that never clears throws incorrect after exactly 2 submits, 2s apart', async () => {
  // Mock setTimeout so the 2s pause is driven by tick() rather than a real (unref'd) timer.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const page = stuckGatePage();
    const rec = { pageUrl: 'https://zoom.test/rec/share/x', strategy: 'zoom' };
    const run = new ZoomExtractor()._captureVideo(page, rec, { passcode: '1234' });
    const outcome = assert.rejects(
      run,
      (err) => err instanceof PasscodeError && err.reason === 'incorrect',
    );
    for (let i = 0; i < 20 && page.fills < 1; i++) await flush();
    assert.equal(page.fills, 1);
    mock.timers.tick(1999);
    for (let i = 0; i < 20; i++) await flush();
    assert.equal(page.fills, 1, 'no second submit before the 2s pause ends');
    mock.timers.tick(1);
    await outcome;
    assert.equal(page.fills, 2);
    assert.equal(page.clicks, 2);
  } finally {
    mock.timers.reset();
  }
});
