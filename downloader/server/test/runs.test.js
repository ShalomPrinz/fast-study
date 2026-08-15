// The pure halves of the section-run engine: the driver's status → outcome mapping, the registry's
// one-run-per-section rule, and the queue loop itself. `createRun` registers without driving and
// `drive` takes its trigger, so nothing here touches auto/ or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, drive, listRuns, outcomeFor, startRun } from '../src/runs.js';

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

// Two tabs on the same course (or one that missed a ping) must not put two drivers on one section.
// All-decided targets keep `startRun`'s driver off the network.
test('a submit for a section already active joins the run in flight', () => {
  const decided = [target('a', 'skipped')];
  const first = createRun({ sectionId: 'c:video:join', course: 'c', targets: decided });
  assert.equal(startRun({ sectionId: 'c:video:join', course: 'c', targets: decided }), first.id);

  first.status = 'paused';
  assert.equal(startRun({ sectionId: 'c:video:join', course: 'c', targets: decided }), first.id);
  assert.equal(listRuns().filter((r) => r.sectionId === 'c:video:join').length, 1);
});

test('a submit for a section whose run ended starts a fresh one', () => {
  const decided = [target('a', 'skipped')];
  for (const status of ['done', 'reconnect', 'cancelled']) {
    const previous = createRun({ sectionId: 'c:video:over', course: 'c', targets: decided });
    previous.status = status;
    const id = startRun({ sectionId: 'c:video:over', course: 'c', targets: decided });
    assert.notEqual(id, previous.id);
  }
});

const answers =
  (byName) =>
  async ({ name }) => {
    const answer = byName[name];
    if (answer instanceof Error) throw answer;
    return answer;
  };

// A non-conforming 2xx body from auto (say `targets` that isn't an array) throws inside the
// trigger. That must cost the row, not wedge the section at `running` forever.
test('a throw while triggering fails just that target', async () => {
  const run = createRun({
    sectionId: 'c:video:throw',
    course: 'c',
    targets: [target('a'), target('b'), target('c')],
  });
  await drive(
    run,
    0,
    answers({
      a: { status: 200, body: { media: 'video' } },
      b: new TypeError('body.targets.map is not a function'),
      c: { status: 200, body: {} },
    }),
  );
  assert.deepEqual(
    run.targets.map((t) => t.disposition),
    ['queued', 'queue-failed', 'queued'],
  );
  assert.deepEqual({ status: run.status, at: run.at }, { status: 'done', at: 3 });
});

// The pre-decided rows are advanced past in one step, so `at` still lands on the total.
test('a fully pre-decided section completes without triggering anything', async () => {
  const run = createRun({
    sectionId: 'c:video:alldone',
    course: 'c',
    targets: ['a', 'b', 'c'].map((n) => target(n, 'skipped')),
  });
  await drive(run, 0, () => assert.fail('a decided target must never be triggered'));
  assert.deepEqual({ status: run.status, at: run.at }, { status: 'done', at: 3 });
});

test('a different section keeps its own run', () => {
  createRun({ sectionId: 'c:video:one', course: 'c', targets: [target('a')] });
  createRun({ sectionId: 'c:video:two', course: 'c', targets: [target('b')] });
  const ids = listRuns()
    .filter((r) => r.sectionId.startsWith('c:video:'))
    .map((r) => r.sectionId);
  assert.ok(ids.includes('c:video:one') && ids.includes('c:video:two'));
});
