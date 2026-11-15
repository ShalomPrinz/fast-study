const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { decide, fail, newer, read, remove, treeDigest, write } = require('../macPending');

let dirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-pending-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

test('newer compares dotted versions by number, and calls anything else not newer', () => {
  assert.equal(newer('0.2.10', '0.2.9'), true);
  assert.equal(newer('1.0.0', '0.9.9'), true);
  assert.equal(newer('0.2.9', '0.2.9'), false);
  assert.equal(newer('0.2.9', '0.2.10'), false);
  assert.equal(newer('0.3', '0.2.9'), true);
  assert.equal(newer('next', '0.2.9'), false);
  assert.equal(newer(undefined, '0.2.9'), false);
});

test('the launch decision, by record and running version', () => {
  const record = (state, version = '2.0.0') => ({ version, state });
  assert.equal(decide(null, '1.0.0'), 'none');
  assert.equal(decide(record('pending'), '1.0.0'), 'install');
  // A swap was started and this older build is the one launching: it did not land.
  assert.equal(decide(record('attempted'), '1.0.0'), 'fail');
  assert.equal(decide(record('failed'), '1.0.0'), 'skip');
  // Stale: the running build is that version already, or past it — the new build's own first launch included.
  for (const state of ['pending', 'attempted', 'failed']) {
    assert.equal(decide(record(state), '2.0.0'), 'clear');
    assert.equal(decide(record(state), '2.0.1'), 'clear');
  }
  assert.equal(decide({}, '1.0.0'), 'clear');
  assert.equal(decide(record('installing'), '1.0.0'), 'clear');
  assert.equal(decide({ state: 'pending', version: 2 }, '1.0.0'), 'clear');
});

test('a record round-trips, and one that is missing or cut off is told apart', () => {
  const dir = path.join(tempDir(), 'update');
  assert.equal(read(dir), null);
  write(dir, { version: '2.0.0', state: 'pending' });
  assert.deepEqual(read(dir), { version: '2.0.0', state: 'pending' });
  assert.deepEqual(fs.readdirSync(dir), ['pending.json']);
  fs.writeFileSync(path.join(dir, 'pending.json'), '{"version": "2.0');
  assert.deepEqual(read(dir), {});
  remove(dir);
  assert.equal(read(dir), null);
});

test('fail drops the staged build and keeps only the version not to try again', () => {
  const dir = path.join(tempDir(), 'update');
  fs.mkdirSync(path.join(dir, 'staged', 'FastStudy.app'), { recursive: true });
  write(dir, { version: '2.0.0', state: 'attempted', digest: 'x' });
  fail(dir, '2.0.0', 'why');
  assert.deepEqual(fs.readdirSync(dir), ['pending.json']);
  assert.deepEqual(read(dir), { version: '2.0.0', state: 'failed', reason: 'why' });
});

test('the tree digest is stable and moves with content, mode, a link target and the file set', async () => {
  const app = path.join(tempDir(), 'FastStudy.app');
  const binary = path.join(app, 'Contents', 'MacOS', 'FastStudy');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'binary', { mode: 0o755 });
  fs.symlinkSync('MacOS/FastStudy', path.join(app, 'Contents', 'Current'));
  const seen = new Set([await treeDigest(app)]);
  assert.equal(await treeDigest(app), [...seen][0]);
  const changes = [
    () => fs.writeFileSync(binary, 'binarx'),
    () => fs.chmodSync(binary, 0o644),
    () => {
      fs.unlinkSync(path.join(app, 'Contents', 'Current'));
      fs.symlinkSync('MacOS/Other', path.join(app, 'Contents', 'Current'));
    },
    () => fs.writeFileSync(path.join(app, 'Contents', '.DS_Store'), ''),
    () => fs.rmSync(binary),
  ];
  for (const change of changes) {
    change();
    const digest = await treeDigest(app);
    assert.equal(seen.has(digest), false);
    seen.add(digest);
  }
  await assert.rejects(treeDigest(path.join(app, 'missing')), /ENOENT/);
});
