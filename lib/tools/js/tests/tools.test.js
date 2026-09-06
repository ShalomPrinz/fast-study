import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolPath, checkTools } from '../tools.js';

let binDir;

beforeEach(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-tools-'));
  process.env.FASTSTUDY_BIN_DIR = binDir;
});

afterEach(() => {
  delete process.env.FASTSTUDY_BIN_DIR;
  fs.rmSync(binDir, { recursive: true, force: true });
});

// Drop an executable at whatever path toolPath resolves `name` to, so the test never has to know
// the platform's exe suffix.
function writeTool(name, exitCode) {
  const file = toolPath(name);
  fs.writeFileSync(file, `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
  return file;
}

test('an unset FASTSTUDY_BIN_DIR leaves the bare name', () => {
  delete process.env.FASTSTUDY_BIN_DIR;
  assert.equal(toolPath('yt-dlp'), 'yt-dlp');
});

test('a set FASTSTUDY_BIN_DIR gives an absolute path in it', () => {
  const resolved = toolPath('yt-dlp');
  assert.ok(path.isAbsolute(resolved));
  assert.equal(path.dirname(resolved), binDir);
});

test('the exe suffix matches the platform', () => {
  const expected = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  assert.equal(path.basename(toolPath('yt-dlp')), expected);
});

test('curl stays on PATH even when a bin dir is set', () => {
  // Windows 10+ ships curl.exe, so it is deliberately not in resources/bin/.
  assert.equal(toolPath('curl'), 'curl');
});

test('a working tool reports ok', async () => {
  writeTool('faketool', 0);
  assert.deepEqual(await checkTools(['faketool']), { faketool: 'ok' });
});

test('an absent tool reports missing', async () => {
  assert.deepEqual(await checkTools(['faketool']), { faketool: 'missing' });
});

test('a failing tool reports its exit code', async () => {
  writeTool('faketool', 3);
  assert.deepEqual(await checkTools(['faketool']), { faketool: 'exited 3' });
});

test('every name is reported', async () => {
  writeTool('good', 0);
  assert.deepEqual(await checkTools(['good', 'bad']), { good: 'ok', bad: 'missing' });
});
