import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolPath, checkTools, NO_WINDOW } from '../tools.js';

let binDir;
let stateDir;

beforeEach(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-tools-'));
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-state-'));
  process.env.FASTSTUDY_BIN_DIR = binDir;
  process.env.FASTSTUDY_STATE_DIR = stateDir;
});

afterEach(() => {
  delete process.env.FASTSTUDY_BIN_DIR;
  delete process.env.FASTSTUDY_STATE_DIR;
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
});

// Drop an executable at whatever path toolPath resolves `name` to, so the test never has to know
// the platform's exe suffix.
function writeTool(name, exitCode) {
  const file = toolPath(name);
  fs.writeFileSync(file, `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
  return file;
}

// An executable that writes the flag it was spawned with to `record`, so a test can pin which
// version flag a name probes with.
function writeArgRecorder(name, record) {
  fs.writeFileSync(toolPath(name), `#!/bin/sh\nprintf '%s' "$1" > '${record}'\n`, { mode: 0o755 });
}

// The self-updated copy of `name` under the state root, at the same basename toolPath resolves it
// to in the bin dir, so the exe-suffix rule is exercised here too.
function writeStateTool(name) {
  const dir = path.join(stateDir, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(toolPath(name)));
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
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

test('NO_WINDOW asks Node for CREATE_NO_WINDOW and nothing else', () => {
  // Every downloader tool spawn spreads it, so an extra key would leak into all of them.
  assert.deepEqual(NO_WINDOW, { windowsHide: true });
});

test('a working tool reports ok', async () => {
  // Success stays the bare string, so every consumer's `!== 'ok'` keeps its meaning.
  writeTool('faketool', 0);
  assert.deepEqual(await checkTools(['faketool']), { faketool: 'ok' });
});

test('an absent tool reports missing', async () => {
  assert.deepEqual(await checkTools(['faketool']), {
    faketool: { state: 'missing', params: { tool: 'faketool' } },
  });
});

test('a failing tool reports its exit code', async () => {
  writeTool('faketool', 3);
  assert.deepEqual(await checkTools(['faketool']), {
    faketool: { state: 'exited 3', params: { tool: 'faketool', exit_code: 3 } },
  });
});

test('an unusable tool carries the OS text as detail', async () => {
  // A directory where the binary should be: the spawn error's text is opaque developer text, so
  // the test pins the param names, never the wording.
  fs.mkdirSync(toolPath('faketool'));
  const result = (await checkTools(['faketool'])).faketool;
  assert.equal(result.params.tool, 'faketool');
  assert.ok(result.params.detail);
  assert.equal(result.state, `unusable: ${result.params.detail}`);
});

test('a failure record carries only state and params', async () => {
  // Nothing resolves a machine code, so the record stays the two fields a consumer reads.
  const result = (await checkTools(['faketool'])).faketool;
  assert.deepEqual(Object.keys(result).sort(), ['params', 'state']);
});

test('every name is reported', async () => {
  writeTool('good', 0);
  const result = await checkTools(['good', 'bad']);
  assert.equal(result.good, 'ok');
  assert.equal(result.bad.state, 'missing');
});

test('ffmpeg probes with one dash', async () => {
  // `--version` exits 1 on ffmpeg, which a preflight would read as a broken binary.
  const record = path.join(stateDir, 'flag');
  writeArgRecorder('ffmpeg', record);
  assert.deepEqual(await checkTools(['ffmpeg']), { ffmpeg: 'ok' });
  assert.equal(fs.readFileSync(record, 'utf8'), '-version');
});

test('a name with no entry probes with the GNU spelling', async () => {
  const record = path.join(stateDir, 'flag');
  writeArgRecorder('faketool', record);
  assert.deepEqual(await checkTools(['faketool']), { faketool: 'ok' });
  assert.equal(fs.readFileSync(record, 'utf8'), '--version');
});

test('a packaged run prefers the self-updated yt-dlp under the state root', () => {
  const updated = writeStateTool('yt-dlp');
  assert.equal(toolPath('yt-dlp'), updated);
});

test('the state copy is ignored in dev, where PATH must win', () => {
  writeStateTool('yt-dlp');
  delete process.env.FASTSTUDY_BIN_DIR;
  assert.equal(toolPath('yt-dlp'), 'yt-dlp');
});

test('without a state copy yt-dlp falls back to the bin dir', () => {
  assert.equal(path.dirname(toolPath('yt-dlp')), binDir);
});

test('a state copy of another tool does not shadow the bundled one', () => {
  writeStateTool('ffmpeg');
  assert.equal(path.dirname(toolPath('ffmpeg')), binDir);
});
