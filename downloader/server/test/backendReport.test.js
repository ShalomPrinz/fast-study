// The arrival report is the only thing the backend needs to apply its auto-run policy, so it must
// survive names the URL can't hold literally and a backend that isn't listening. `fetch` is stubbed
// on the global — nothing here touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportVideoArrived } from '../src/services/backend.js';
import { BACKEND_URL } from '../src/config.js';

// Returns the calls a stubbed fetch recorded; `impl` decides what each call answers.
function withFetch(impl, run) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    calls.push({ url, init });
    return impl();
  };
  try {
    run();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

test('percent-encodes every segment of the arrival URL', () => {
  const calls = withFetch(
    () => Promise.resolve({ ok: true }),
    () => reportVideoArrived('Algo 1/2', 'שיעור 3 & 4', 'recitation'),
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${BACKEND_URL}/courses/Algo%201%2F2/lectures/%D7%A9%D7%99%D7%A2%D7%95%D7%A8%203%20%26%204/video-arrived?kind=recitation`,
  );
  assert.equal(calls[0].init.method, 'POST');
});

test('a rejected fetch never escapes to the caller', async () => {
  const calls = withFetch(
    () => Promise.reject(new Error('ECONNREFUSED')),
    () => assert.doesNotThrow(() => reportVideoArrived('c', 'l', 'lecture')),
  );

  assert.equal(calls.length, 1);
  // The rejection is settled a microtask later; an unhandled one would fail the test run here.
  await new Promise((resolve) => setImmediate(resolve));
});
