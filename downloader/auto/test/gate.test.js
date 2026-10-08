// The Moodle lock: one request at a time, freed 3s after it ends; a frontend caller is refused while
// it is taken, server/'s own calls queue FIFO, and a call outside any request never goes out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MoodleGate, moodleGate } from '../src/moodle/gate.js';
import { getCourseContents } from '../src/moodle/wsClient.js';

const tick = () => new Promise((r) => setImmediate(r));

// A request that takes the lock and holds it until `end()`.
function holding(gate, opts = {}) {
  let end;
  const ended = new Promise((r) => (end = r));
  const done = gate.run(opts, async () => {
    await gate.enter('x');
    await ended;
  });
  return { end, done };
}

test('a frontend request is refused while another holds the lock, before it sends anything', async () => {
  const gate = new MoodleGate({ cooldownMs: 0 });
  const first = holding(gate);
  await tick();
  let sent = false;
  const err = await gate
    .run({}, async () => {
      await gate.enter('x');
      sent = true;
    })
    .catch((e) => e);
  assert.equal(err.code, 'moodle_busy');
  assert.equal(sent, false);
  first.end();
  await first.done;
});

test('two near-simultaneous frontend requests: exactly one proceeds', async () => {
  const gate = new MoodleGate({ cooldownMs: 0 });
  const call = () => gate.run({}, () => gate.enter('x').then(() => 'ok'));
  const results = await Promise.allSettled([call(), call()]);
  assert.deepEqual(
    results.map((r) => r.value ?? r.reason.code),
    ['ok', 'moodle_busy'],
  );
});

test('a request with no Moodle call never takes the lock', async () => {
  const gate = new MoodleGate();
  await gate.run({}, async () => 'zoom');
  assert.equal(gate.busy(), false);
});

test('waiting requests run one at a time, in arrival order', async () => {
  const gate = new MoodleGate({ cooldownMs: 0 });
  const first = holding(gate);
  await tick();
  const order = [];
  const queued = ['a', 'b', 'c'].map((name) =>
    gate.run({ wait: true }, async () => {
      await gate.enter('x');
      order.push(`${name}:start`);
      await tick();
      order.push(`${name}:end`);
    }),
  );
  await tick();
  assert.deepEqual(order, []);
  first.end();
  await Promise.all(queued);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
});

test('the lock frees 3s after the request ends, and busy reads true until then', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = new MoodleGate();
  const changes = [];
  gate.on('change', (busy) => changes.push(busy));
  await gate.run({}, () => gate.enter('x'));
  assert.equal(gate.busy(), true);
  assert.equal((await gate.run({}, () => gate.enter('x')).catch((e) => e)).code, 'moodle_busy');
  t.mock.timers.tick(2999);
  assert.equal(gate.busy(), true);
  t.mock.timers.tick(1);
  assert.equal(gate.busy(), false);
  assert.deepEqual(changes, [true, false]);
});

test('a waiter is handed the lock after the cooldown with no false in between', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = new MoodleGate();
  const changes = [];
  gate.on('change', (busy) => changes.push(busy));
  const first = holding(gate);
  await tick();
  let ran = false;
  const waiter = gate.run({ wait: true }, async () => {
    await gate.enter('x');
    ran = true;
  });
  first.end();
  await first.done;
  await tick();
  assert.equal(ran, false);
  t.mock.timers.tick(3000);
  await waiter;
  assert.equal(ran, true);
  t.mock.timers.tick(3000);
  assert.deepEqual(changes, [true, false]);
});

test('a thrown error still releases the lock', async () => {
  const gate = new MoodleGate({ cooldownMs: 0 });
  const err = await gate
    .run({}, async () => {
      await gate.enter('x');
      throw new Error('boom');
    })
    .catch((e) => e);
  assert.equal(err.message, 'boom');
  assert.equal(gate.busy(), false);
});

test('a lease keeps the lock past its request until released, and its run() reuses it', async () => {
  const gate = new MoodleGate({ cooldownMs: 0 });
  let lease;
  await gate.run({}, async () => {
    lease = await gate.hold();
  });
  assert.equal(gate.busy(), true);
  assert.equal((await gate.run({}, () => gate.enter('x')).catch((e) => e)).code, 'moodle_busy');
  await lease.run(() => gate.enter('x')); // the lease's own request passes
  lease.release();
  lease.release(); // idempotent
  assert.equal(gate.busy(), false);
});

test('a waiter whose caller went away leaves the queue', async () => {
  const gate = new MoodleGate({ cooldownMs: 0 });
  const first = holding(gate);
  await tick();
  const gone = new AbortController();
  let sent = false;
  const waiter = gate.run({ wait: true, signal: gone.signal }, async () => {
    await gate.enter('x');
    sent = true;
  });
  gone.abort();
  await assert.rejects(waiter);
  first.end();
  await first.done;
  assert.equal(sent, false);
  assert.equal(gate.busy(), false);
});

test('a call outside any request, or after its request ended, is aborted unsent', async (t) => {
  let fetched = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetched++;
  });
  const err = await getCourseContents('https://moodle.test', 'tok', '1').catch((e) => e);
  assert.equal(err.code, 'moodle_call_ungated');
  assert.deepEqual(err.params, { target: 'https://moodle.test/webservice/rest/server.php' });

  let later;
  await moodleGate.run({}, async () => {
    later = () => getCourseContents('https://moodle.test', 'tok', '1');
  });
  assert.equal((await later().catch((e) => e)).code, 'moodle_call_ungated');
  assert.equal(fetched, 0);
});
