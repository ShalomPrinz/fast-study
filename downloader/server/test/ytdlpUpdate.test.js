// The seed decision and the seed itself; the `-U` spawn is not exercised here, per the suite's
// no-subprocess rule — every case below leaves no copy, so updateYtdlp() spawns nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { needsSeed, seedYtdlp, updateYtdlp } from '../src/services/ytdlpUpdate.js';

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

// Runs `body({ binDir, stateDir, copy, errors })` with both env vars pointed at fresh temp dirs and
// console.error collected, so a test can assert the one-line-per-failure contract.
function withDirs(body, { packaged = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-update-'));
  const binDir = path.join(root, 'bin');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(binDir);
  fs.mkdirSync(stateDir);
  const prevBin = process.env.FASTSTUDY_BIN_DIR;
  const prevState = process.env.FASTSTUDY_STATE_DIR;
  if (packaged) process.env.FASTSTUDY_BIN_DIR = binDir;
  else delete process.env.FASTSTUDY_BIN_DIR;
  process.env.FASTSTUDY_STATE_DIR = stateDir;
  const errors = [];
  const realError = console.error;
  console.error = (line) => errors.push(line);
  try {
    body({ binDir, stateDir, copy: path.join(stateDir, 'bin', 'yt-dlp'), errors });
  } finally {
    console.error = realError;
    if (prevBin === undefined) delete process.env.FASTSTUDY_BIN_DIR;
    else process.env.FASTSTUDY_BIN_DIR = prevBin;
    if (prevState === undefined) delete process.env.FASTSTUDY_STATE_DIR;
    else process.env.FASTSTUDY_STATE_DIR = prevState;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('seeds the shipped binary into the state root', () => {
  withDirs(({ binDir, copy, errors }) => {
    fs.writeFileSync(path.join(binDir, 'yt-dlp'), 'shipped');
    seedYtdlp();
    assert.equal(fs.readFileSync(copy, 'utf8'), 'shipped');
    assert.deepEqual(fs.readdirSync(path.dirname(copy)), ['yt-dlp']); // no temp left behind
    assert.deepEqual(errors, []);
  });
});

// A failed rename must not strand the ~17MB temp copy: Windows refuses to replace a copy another
// service is running, and every later boot retries the seed.
test('a failed rename leaves no temp file behind, and one stderr line', () => {
  withDirs(({ binDir, copy, errors }) => {
    const bundled = path.join(binDir, 'yt-dlp');
    fs.writeFileSync(bundled, 'shipped');
    // A non-empty directory where the copy belongs: renaming a file onto it cannot succeed.
    fs.mkdirSync(copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'occupied'), '');
    fs.utimesSync(bundled, new Date(), new Date(Date.now() + 60_000)); // newer, so a seed is due
    seedYtdlp();
    assert.deepEqual(fs.readdirSync(path.dirname(copy)), ['yt-dlp']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /cannot seed/);
  });
});

// Antivirus quarantine or a half-finished install: nothing to seed from, so say so once and leave
// any existing copy (which updateYtdlp still updates) alone.
test('reports a missing shipped binary in one line and seeds nothing', () => {
  withDirs(({ stateDir, errors }) => {
    seedYtdlp();
    updateYtdlp();
    assert.deepEqual(fs.readdirSync(stateDir), []);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no shipped binary/);
  });
});

// Dev: nothing is seeded and nothing is spawned, so the developer's own PATH yt-dlp is never
// shadowed by a state copy.
test('does nothing at all without FASTSTUDY_BIN_DIR', () => {
  withDirs(
    ({ stateDir, errors }) => {
      seedYtdlp();
      updateYtdlp();
      assert.deepEqual(fs.readdirSync(stateDir), []);
      assert.deepEqual(errors, []);
    },
    { packaged: false },
  );
});
