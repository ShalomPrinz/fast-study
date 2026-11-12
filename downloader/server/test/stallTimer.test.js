// The stall timer's lifetime: armed only while a job is running (docs/JOBS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStalls,
  createJob,
  finishJob,
  listJobs,
  restartJob,
  startJob,
  stallTimerArmed,
  STALL_MS,
} from '../src/jobs.js';

const job = (id) => listJobs().find((j) => j.id === id);
const running = (lecture, extra = {}) => {
  const id = createJob({ course: 'C', lecture, kind: 'video', tool: 'curl', ...extra });
  startJob(id, { tempDir: '/nonexistent-stall-timer', measure: 'file' });
  return id;
};

test('the stall timer is armed while a job runs, cleared after the last one ends, and re-armed', () => {
  assert.equal(stallTimerArmed(), false, 'nothing ticks before the first job');
  createJob({ course: 'C', lecture: 'Queued', kind: 'video', tool: 'curl' });
  assert.equal(stallTimerArmed(), false, 'a queued job arms nothing');

  const a = running('A');
  const b = running('B');
  assert.equal(stallTimerArmed(), true);
  finishJob(a, 'done');
  assert.equal(stallTimerArmed(), true, 'another job still runs');

  checkStalls(job(b).startedAt + STALL_MS);
  assert.equal(job(b).stalled, true);
  finishJob(b, 'error', 'x', 'download_tool_failed', {});
  assert.equal(stallTimerArmed(), false);
  assert.equal(job(b).stalled, false, 'no stale flag once the timer stopped');

  const c = running('C');
  assert.equal(stallTimerArmed(), true, 'a later job re-arms it');
  finishJob(c, 'cancelled');
  assert.equal(stallTimerArmed(), false);
});

test('a restart that drops the only running job clears the timer', () => {
  const id = running('R', { restart: () => 'new-id' });
  assert.equal(stallTimerArmed(), true);
  assert.deepEqual(restartJob(id), { id: 'new-id' });
  assert.equal(stallTimerArmed(), false);
});
