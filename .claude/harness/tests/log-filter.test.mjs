import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBenignAbort } from '../lib/log-filter.mjs';

test('only an ERR_ABORTED after a 204 is benign', () => {
  assert.equal(isBenignAbort('net::ERR_ABORTED', 204), true);
  assert.equal(isBenignAbort('net::ERR_ABORTED', 200), false);
  assert.equal(isBenignAbort('net::ERR_ABORTED', undefined), false);
  assert.equal(isBenignAbort('net::ERR_FAILED', 204), false);
  assert.equal(isBenignAbort(undefined, 204), false);
});
