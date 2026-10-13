const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { afterEach, test } = require('node:test');

const {
  REG_KEY,
  batchPath,
  hostBatch,
  registerHost,
  removeBridge,
  syncExtension,
  writeBridge,
} = require('../extension');

const HOST = path.join(__dirname, '..', 'bridge', 'host.js');
let dirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-ext-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** Run the host as Chrome would: one framed message on stdin, one framed reply read off stdout. */
function askHost(bridgeFile, message = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST, bridgeFile], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const out = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      const raw = Buffer.concat(out);
      const length = raw.readUInt32LE(0);
      assert.equal(raw.length, 4 + length, 'stdout holds exactly one frame');
      resolve({ code, reply: JSON.parse(raw.subarray(4).toString('utf8')) });
    });
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    // Left open, as Chrome leaves it: the host must answer on the frame, not on end-of-input.
    child.stdin.write(Buffer.concat([header, body]));
  });
}

test('the host answers a framed request with the bridge file', async () => {
  const file = path.join(tempDir(), 'bridge.json');
  const bridge = { port: 41234, secret: 'ab'.repeat(32), extensionVersion: '1.0.0' };
  writeBridge(file, bridge);
  assert.deepEqual(await askHost(file), { code: 0, reply: bridge });
});

test('the host answers {running:false} once the bridge file is removed', async () => {
  const file = path.join(tempDir(), 'bridge.json');
  writeBridge(file, { port: 1, secret: 's', extensionVersion: '1.0.0' });
  removeBridge(file);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(await askHost(file), { code: 0, reply: { running: false } });
});

test('writeBridge leaves no tmp file behind and is owner-only on POSIX', () => {
  const dir = tempDir();
  const file = path.join(dir, 'bridge.json');
  writeBridge(file, { port: 2 });
  writeBridge(file, { port: 3 });
  assert.deepEqual(fs.readdirSync(dir), ['bridge.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { port: 3 });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('batchPath swaps the longest env prefix for its variable and doubles a literal %', () => {
  const env = { USERPROFILE: 'C:\\Users\\שלום', LOCALAPPDATA: 'C:\\Users\\שלום\\AppData\\Local\\' };
  assert.equal(
    batchPath('C:\\Users\\שלום\\AppData\\Local\\Programs\\faststudy\\FastStudy.exe', env),
    '"%LOCALAPPDATA%\\Programs\\faststudy\\FastStudy.exe"',
  );
  assert.equal(batchPath('c:\\users\\שלום\\x', env), '"%USERPROFILE%\\x"');
  // A prefix must end on a separator, not mid-name.
  assert.equal(batchPath('C:\\Users\\שלוםX\\a', env), '"C:\\Users\\שלוםX\\a"');
  assert.equal(batchPath('D:\\100% sure\\a', {}), '"D:\\100%% sure\\a"');
});

test('hostBatch echoes nothing and runs the exe as node on the host script', () => {
  const batch = hostBatch({
    exe: 'C:\\L\\Programs\\faststudy\\FastStudy.exe',
    script: 'C:\\L\\Programs\\faststudy\\resources\\bridge\\host.js',
    bridgeFile: 'C:\\L\\FastStudy\\bridge.json',
    env: { LOCALAPPDATA: 'C:\\L' },
  });
  assert.equal(
    batch,
    '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n' +
      '"%LOCALAPPDATA%\\Programs\\faststudy\\FastStudy.exe" ' +
      '"%LOCALAPPDATA%\\Programs\\faststudy\\resources\\bridge\\host.js" ' +
      '"%LOCALAPPDATA%\\FastStudy\\bridge.json"\r\n',
  );
});

test('registerHost writes the .bat and host manifest, then sets the registry default value', () => {
  const stateDir = tempDir();
  const calls = [];
  const lines = [];
  const options = {
    stateDir,
    exe: '/x/FastStudy.exe',
    script: '/x/resources/bridge/host.js',
    bridgeFile: path.join(stateDir, 'bridge.json'),
    log: (_source, line) => lines.push(line),
    env: {},
    run: (command, args, _options, done) => {
      calls.push([command, ...args]);
      done(null);
    },
  };
  registerHost(options);
  const manifestFile = path.join(stateDir, 'native-host', 'com.faststudy.bridge.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.deepEqual(manifest, {
    name: 'com.faststudy.bridge',
    description: manifest.description,
    path: path.join(stateDir, 'native-host', 'host.bat'),
    type: 'stdio',
    allowed_origins: ['chrome-extension://hknnjgdhokbapjodjklfodhobjekjlnn/'],
  });
  assert.match(fs.readFileSync(manifest.path, 'utf8'), /^@echo off\r\n/);
  assert.deepEqual(calls, [
    ['reg', 'add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f'],
  ]);
  assert.equal(
    REG_KEY,
    'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.faststudy.bridge',
  );
  // Idempotent: a second launch rewrites nothing that did not change.
  const before = fs.statSync(manifest.path).mtimeMs;
  registerHost(options);
  assert.equal(fs.statSync(manifest.path).mtimeMs, before);
  assert.equal(calls.length, 2);
});

test('registerHost logs a failed registry write and does not throw', () => {
  const lines = [];
  registerHost({
    stateDir: tempDir(),
    exe: 'e',
    script: 's',
    bridgeFile: 'b',
    log: (_source, line) => lines.push(line),
    env: {},
    run: (_command, _args, _options, done) => done(new Error('reg is not here')),
  });
  assert.deepEqual(lines, ['native host registry write failed: reg is not here']);
});

const writeExtension = (dir, version, files = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version }));
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), content);
};

test('syncExtension copies when the copy is missing, keeps a current one, replaces a stale one whole', () => {
  const root = tempDir();
  const source = path.join(root, 'resources', 'extension');
  const target = path.join(root, 'state', 'extension');
  fs.mkdirSync(path.dirname(target));
  writeExtension(source, '1.0.0', { 'popup.js': 'v1' });

  assert.match(syncExtension(source, target), /missing → 1\.0\.0/);
  assert.equal(fs.readFileSync(path.join(target, 'popup.js'), 'utf8'), 'v1');

  // Same version: left alone, even a file the user changed.
  fs.writeFileSync(path.join(target, 'popup.js'), 'edited');
  assert.equal(syncExtension(source, target), 'extension 1.0.0 current');
  assert.equal(fs.readFileSync(path.join(target, 'popup.js'), 'utf8'), 'edited');

  // A new version: the folder is replaced, so a file the release dropped is gone too.
  fs.writeFileSync(path.join(target, 'stale.js'), 'old');
  fs.rmSync(source, { recursive: true });
  writeExtension(source, '1.1.0', { 'popup.js': 'v2' });
  assert.match(syncExtension(source, target), /1\.0\.0 → 1\.1\.0/);
  assert.deepEqual(fs.readdirSync(target).sort(), ['manifest.json', 'popup.js']);
  assert.equal(fs.readFileSync(path.join(target, 'popup.js'), 'utf8'), 'v2');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['extension']);
});

test('syncExtension throws when nothing was shipped', () => {
  const root = tempDir();
  assert.throws(() => syncExtension(path.join(root, 'none'), path.join(root, 'ext')), /no shipped/);
});
