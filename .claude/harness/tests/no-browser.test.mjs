import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noBrowserError } from '../lib/no-browser.mjs';

test('only a channel launch under the flag fails, with the Playwright wording', () => {
  assert.match(
    noBrowserError({ channel: 'chrome' }, true).message,
    /^Chromium distribution 'chrome' is not found at /,
  );
  assert.match(
    noBrowserError({ channel: 'msedge' }, true).message,
    /^Chromium distribution 'msedge' is not found at \/opt\/microsoft\/msedge\/msedge\n/,
  );
  assert.equal(noBrowserError({ channel: 'chrome' }, false), null);
  assert.equal(noBrowserError({}, true), null);
  assert.equal(noBrowserError(undefined, true), null);
});
