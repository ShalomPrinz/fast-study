// The job registry's retention: a `done` job outlives its terminal ping by the bridge, and its
// eviction pings subscribers like every other transition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { subscribe } from '../src/events.js';
import { createJob, DONE_BRIDGE_MS, finishJob, listJobs } from '../src/jobs.js';

// A stand-in SSE response that counts `job:change` frames.
function fakeStream() {
  const res = Object.assign(new EventEmitter(), { pings: 0 });
  res.writeHead = () => {};
  res.write = (frame) => {
    if (frame.startsWith('event: job:change')) res.pings += 1;
  };
  subscribe(res);
  return res;
}

test('a done job is evicted after the bridge, with a ping', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const res = fakeStream();
  t.after(() => res.emit('close'));

  const id = createJob({ course: 'C', lecture: 'L1', kind: 'video', tool: 'curl' });
  finishJob(id, 'done');
  const pings = res.pings;
  assert.ok(
    listJobs().some((j) => j.id === id),
    'a resync on the done ping still finds the job',
  );

  t.mock.timers.tick(DONE_BRIDGE_MS);
  assert.ok(!listJobs().some((j) => j.id === id));
  assert.equal(res.pings, pings + 1);
});

test('a superseded done job evicts silently when its bridge fires', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const res = fakeStream();
  t.after(() => res.emit('close'));

  const first = createJob({ course: 'C', lecture: 'L2', kind: 'video', tool: 'curl' });
  finishJob(first, 'done');
  const retry = createJob({ course: 'C', lecture: 'L2', kind: 'video', tool: 'curl' });
  const pings = res.pings;

  t.mock.timers.tick(DONE_BRIDGE_MS);
  assert.ok(
    listJobs().some((j) => j.id === retry),
    'the retry survives its predecessor’s timer',
  );
  assert.equal(res.pings, pings);
});
