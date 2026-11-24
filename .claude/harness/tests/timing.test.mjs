import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { seedTiming, timingSamples } from '../lib/timing.mjs';

test('every operation has three samples, each longer than a second', () => {
  const rows = timingSamples();
  assert.equal(rows.length, 24);
  assert.deepEqual(new Set(rows.map((r) => r[0])).size, 8);
  assert.ok(rows.every((r) => r[1] > 0 && r[2] >= 6));
});

test('seedTiming replaces what the table held', async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-timing-'));
  try {
    await seedTiming({ state });
    await seedTiming({ state });
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(state, 'timing.db'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM timing').get().n, 24);
    db.close();
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});
