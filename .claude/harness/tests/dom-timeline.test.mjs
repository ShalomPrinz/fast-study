import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { changes, createStore, flickers, parseTime } from '../lib/dom-timeline.mjs';

const state = (t, frame, texts, { doc = 1, ids } = {}) => ({
  t,
  frame,
  doc,
  matches: texts.map((text, i) => ({ id: ids?.[i] ?? i + 1, text })),
});

describe('createStore', () => {
  const snap = (doc, t, size) => ({ doc, t, frame: 0, size, url: '/', snap: [] });
  const ops = (doc, t, size) => ({ doc, t, frame: 1, size, ops: [] });

  test('drops the oldest segment once over budget, never the current one', () => {
    const store = createStore({ budget: 100, windowMs: 1e9, clock: () => 0 });
    store.take(snap('a', 0, 60));
    store.take(snap('a', 1, 60));
    assert.deepEqual(
      store.segments.map((s) => s.t),
      [1],
    );
  });

  test('a batch from a replaced document is ignored', () => {
    const store = createStore({ clock: () => 0 });
    store.take(snap('a', 0, 1));
    store.take(snap('b', 1, 1));
    store.take(ops('a', 2, 5));
    assert.equal(store.total(), 2);
  });

  test('drops a segment wholly older than the window', () => {
    let now = 0;
    const store = createStore({ budget: 1e9, windowMs: 1000, clock: () => now });
    store.take(snap('a', 0, 1));
    store.take(snap('a', 500, 1));
    now = 1600;
    store.take(ops('a', 1600, 1));
    assert.deepEqual(
      store.segments.map((s) => s.t),
      [500],
    );
  });
});

describe('changes', () => {
  test('keeps a remount, drops a repeat, starts at the last state before since', () => {
    const states = [
      state(0, 0, ['a']),
      state(10, 1, ['a']),
      state(20, 2, ['a'], { ids: [9] }),
      state(30, 3, ['b']),
    ];
    assert.deepEqual(
      changes(states).map((s) => s.t),
      [0, 20, 30],
    );
    assert.deepEqual(
      changes(states, 25).map((s) => s.t),
      [20, 30],
    );
  });
});

describe('flickers', () => {
  test('an absence come back within maxMs, painted when a frame passed', () => {
    const runs = flickers(
      [state(0, 0, ['x']), state(100, 5, []), state(120, 6, ['x']), state(900, 40, [])],
      300,
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].to - runs[0].from, 20);
    assert.equal(runs[0].painted, true);
  });

  test('a state that came and went within one frame was never painted', () => {
    const runs = flickers([state(0, 0, ['x']), state(5, 3, ['…']), state(6, 3, ['x'])], 300);
    assert.equal(runs[0].painted, false);
  });

  test('a remount alone is no flicker, nor a change that never comes back', () => {
    const states = [state(0, 0, ['x']), state(5, 1, ['x'], { ids: [7] }), state(10, 2, ['y'])];
    assert.deepEqual(flickers(states, 300), []);
  });
});

test('parseTime takes ISO, epoch ms and negative ms back', () => {
  assert.equal(parseTime('2026-10-06T00:00:00Z'), Date.parse('2026-10-06T00:00:00Z'));
  assert.equal(parseTime('1234'), 1234);
  assert.equal(parseTime('-500', 10_000), 9_500);
  assert.equal(parseTime(undefined), undefined);
  assert.throws(() => parseTime('soon'));
});
