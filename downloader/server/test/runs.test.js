// The pure halves of the section-run engine: the driver's status → outcome mapping, and the
// registry's one-run-per-section rule. `createRun` registers without driving, so nothing here
// touches auto/ or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, listRuns, outcomeFor } from '../src/runs.js';

test('a 2xx queues the target', () => {
  assert.deepEqual(outcomeFor(200), { disposition: 'queued' });
});

test('401 abandons the run for a reconnect, 409 parks it', () => {
  assert.deepEqual(outcomeFor(401), { status: 'reconnect' });
  assert.deepEqual(outcomeFor(409), { status: 'paused' });
});

test('422 records the row unsupported and the queue continues', () => {
  assert.deepEqual(outcomeFor(422), { disposition: 'unsupported' });
});

// Everything auto/ has no contract for — a 500, a 502, or status 0 (unreachable) — is one row's
// failure, never the run's.
test('any other status fails just that target', () => {
  for (const status of [0, 400, 500, 502]) {
    assert.deepEqual(outcomeFor(status), { disposition: 'queue-failed' });
  }
});

const target = (name, disposition) => ({ ref: `r-${name}`, name, kind: 'lecture', disposition });

test('only a caller-decided disposition survives; the rest start pending', () => {
  const run = createRun({
    sectionId: 'c:video:pending',
    course: 'c',
    targets: [
      target('a', 'skipped'),
      target('b', 'unsupported'),
      target('c', 'queued'),
      target('d'),
    ],
  });
  assert.deepEqual(
    run.targets.map((t) => t.disposition),
    ['skipped', 'unsupported', 'pending', 'pending'],
  );
  assert.deepEqual(
    { at: run.at, total: run.total, status: run.status },
    {
      at: 0,
      total: 4,
      status: 'running',
    },
  );
});

test('a second run for the same section replaces the first outright', () => {
  const first = createRun({ sectionId: 'c:video:S', course: 'c', targets: [target('a')] });
  const second = createRun({ sectionId: 'c:video:S', course: 'c', targets: [target('b')] });

  const forSection = listRuns().filter((r) => r.sectionId === 'c:video:S');
  assert.equal(forSection.length, 1);
  assert.equal(forSection[0].id, second.id);
  assert.notEqual(second.id, first.id);
});

test('a different section keeps its own run', () => {
  createRun({ sectionId: 'c:video:one', course: 'c', targets: [target('a')] });
  createRun({ sectionId: 'c:video:two', course: 'c', targets: [target('b')] });
  const ids = listRuns()
    .filter((r) => r.sectionId.startsWith('c:video:'))
    .map((r) => r.sectionId);
  assert.ok(ids.includes('c:video:one') && ids.includes('c:video:two'));
});
