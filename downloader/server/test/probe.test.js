import test from 'node:test';
import assert from 'node:assert/strict';
import { probeContentLength } from '../src/services/probe.js';

test('probeContentLength: a body.cancel() that rejects is no unhandled rejection', async (t) => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    process.off('unhandledRejection', onUnhandled);
  });
  // HEAD answers without a length, so the ranged GET runs too: both cancels reject.
  globalThis.fetch = async (_url, { method }) => ({
    status: 200,
    headers: new Headers(method === 'GET' ? { 'content-range': 'bytes 0-0/42' } : {}),
    body: { cancel: () => Promise.reject(new Error('stream errored')) },
  });
  assert.equal(await probeContentLength('https://cdn.test/a.mp4', []), 42);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(unhandled, []);
});
