// The zoom passcode gate's retry budget, driven through a stub page.
import test from 'node:test';
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

test('a gate that never clears throws incorrect after exactly 2 submits', async () => {
  const page = stuckGatePage();
  const rec = { pageUrl: 'https://zoom.test/rec/share/x', strategy: 'zoom' };
  await assert.rejects(
    new ZoomExtractor()._captureVideo(page, rec, { passcode: '1234' }),
    (err) => err instanceof PasscodeError && err.reason === 'incorrect',
  );
  assert.equal(page.fills, 2);
  assert.equal(page.clicks, 2);
});
