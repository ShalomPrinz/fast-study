// The seed decision only; the copy and the `-U` spawn are not exercised here, per the suite's
// no-subprocess rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { needsSeed, updateYtdlp } from '../src/services/ytdlpUpdate.js';

test('seeds when the copy is absent', () => {
  assert.equal(needsSeed(1000, null), true);
});

test('seeds when the bundled binary is newer than the copy', () => {
  assert.equal(needsSeed(2000, 1000), true);
});

test('leaves a copy that is as new as the bundled binary, or newer', () => {
  assert.equal(needsSeed(1000, 1000), false);
  assert.equal(needsSeed(1000, 2000), false);
});

// Dev: nothing is seeded, so the developer's own PATH yt-dlp is never shadowed by a state copy.
test('does nothing at all without FASTSTUDY_BIN_DIR', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-update-'));
  const binDir = process.env.FASTSTUDY_BIN_DIR;
  const prevState = process.env.FASTSTUDY_STATE_DIR;
  delete process.env.FASTSTUDY_BIN_DIR;
  process.env.FASTSTUDY_STATE_DIR = stateDir;
  try {
    updateYtdlp();
    assert.deepEqual(fs.readdirSync(stateDir), []);
  } finally {
    if (binDir !== undefined) process.env.FASTSTUDY_BIN_DIR = binDir;
    if (prevState === undefined) delete process.env.FASTSTUDY_STATE_DIR;
    else process.env.FASTSTUDY_STATE_DIR = prevState;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
