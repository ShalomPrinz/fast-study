const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { afterEach, test } = require('node:test');

const {
  REG_KEYS,
  batchPath,
  hostBatch,
  hostScript,
  registerHost,
  registerHostMac,
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
function askHost(bridgeFile, message = {}, command = process.execPath, args = [HOST, bridgeFile]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
    ['reg', 'add', REG_KEYS.Chrome, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f'],
    ['reg', 'add', REG_KEYS.Edge, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f'],
  ]);
  assert.deepEqual(REG_KEYS, {
    Chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.faststudy.bridge',
    Edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.faststudy.bridge',
  });
  assert.deepEqual(lines, [
    `native host registered (Chrome): ${manifestFile}`,
    `native host registered (Edge): ${manifestFile}`,
  ]);
  // Idempotent: a second launch rewrites nothing that did not change.
  const before = fs.statSync(manifest.path).mtimeMs;
  registerHost(options);
  assert.equal(fs.statSync(manifest.path).mtimeMs, before);
  assert.equal(calls.length, 4);
});

test('registerHost logs a failed registry write per key, and one failing still writes the other', () => {
  const stateDir = tempDir();
  const manifestFile = path.join(stateDir, 'native-host', 'com.faststudy.bridge.json');
  const run = (failing) => {
    const lines = [];
    const keys = [];
    registerHost({
      stateDir,
      exe: 'e',
      script: 's',
      bridgeFile: 'b',
      log: (_source, line) => lines.push(line),
      env: {},
      run: (_command, args, _options, done) => {
        keys.push(args[1]);
        done(args[1] === failing ? new Error('reg is not here') : null);
      },
    });
    return { lines, keys };
  };
  for (const [browser, other] of [
    ['Chrome', 'Edge'],
    ['Edge', 'Chrome'],
  ]) {
    const { lines, keys } = run(REG_KEYS[browser]);
    assert.deepEqual(keys, [REG_KEYS.Chrome, REG_KEYS.Edge]);
    assert.deepEqual(
      lines.toSorted(),
      [
        `native host registered (${other}): ${manifestFile}`,
        `native host registry write failed (${browser}): reg is not here`,
      ].toSorted(),
    );
  }
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

test('registerHostMac writes an executable host script and one manifest per browser, once', () => {
  const stateDir = tempDir();
  const home = tempDir();
  const lines = [];
  const options = {
    stateDir,
    exe: '/Applications/FastStudy.app/Contents/MacOS/FastStudy',
    script: '/Applications/FastStudy.app/Contents/Resources/bridge/host.js',
    bridgeFile: path.join(stateDir, 'bridge.json'),
    home,
    log: (_source, line) => lines.push(line),
  };
  registerHostMac(options);
  const script = path.join(stateDir, 'native-host', 'host.sh');
  assert.equal(
    fs.readFileSync(script, 'utf8'),
    "#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Applications/FastStudy.app/Contents/MacOS/FastStudy' " +
      `'/Applications/FastStudy.app/Contents/Resources/bridge/host.js' '${options.bridgeFile}'\n`,
  );
  assert.equal(fs.statSync(script).mode & 0o777, 0o755);
  const support = path.join(home, 'Library', 'Application Support');
  const manifests = [
    path.join(support, 'Google', 'Chrome', 'NativeMessagingHosts', 'com.faststudy.bridge.json'),
    path.join(support, 'Microsoft Edge', 'NativeMessagingHosts', 'com.faststudy.bridge.json'),
  ];
  for (const file of manifests) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(manifest, {
      name: 'com.faststudy.bridge',
      description: manifest.description,
      path: script,
      type: 'stdio',
      allowed_origins: ['chrome-extension://hknnjgdhokbapjodjklfodhobjekjlnn/'],
    });
  }
  assert.deepEqual(lines, [
    `native host registered (Chrome): ${manifests[0]}`,
    `native host registered (Edge): ${manifests[1]}`,
  ]);
  // Idempotent: a second launch rewrites nothing that did not change.
  const files = [script, ...manifests];
  const before = files.map((file) => fs.statSync(file).mtimeMs);
  registerHostMac(options);
  assert.deepEqual(
    files.map((file) => fs.statSync(file).mtimeMs),
    before,
  );
});

test('registerHostMac points the host script at the bundle the app moved to', () => {
  const stateDir = tempDir();
  const home = tempDir();
  const at = (bundle) => ({
    stateDir,
    exe: `${bundle}/Contents/MacOS/FastStudy`,
    script: `${bundle}/Contents/Resources/bridge/host.js`,
    bridgeFile: path.join(stateDir, 'bridge.json'),
    home,
    log: () => {},
  });
  registerHostMac(at('/Volumes/FastStudy/FastStudy.app'));
  registerHostMac(at('/Applications/FastStudy.app'));
  const script = path.join(stateDir, 'native-host', 'host.sh');
  const text = fs.readFileSync(script, 'utf8');
  assert.match(text, / exec '\/Applications\/FastStudy\.app\/Contents\/MacOS\/FastStudy' /);
  assert.doesNotMatch(text, /Volumes/);
  // The manifests name the script, whose path the move does not change.
  const manifest = path.join(
    home,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts',
    'com.faststudy.bridge.json',
  );
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).path, script);
});

test('registerHostMac logs one browser failing and still writes the other', () => {
  const stateDir = tempDir();
  const home = tempDir();
  // A file where Chrome's folder would go, so its mkdir fails.
  fs.mkdirSync(path.join(home, 'Library', 'Application Support'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Google'), '');
  const lines = [];
  registerHostMac({
    stateDir,
    exe: 'e',
    script: 's',
    bridgeFile: 'b',
    home,
    log: (_source, line) => lines.push(line),
  });
  assert.match(lines[0], /^native host manifest write failed \(Chrome\): /);
  assert.match(lines[1], /^native host registered \(Edge\): /);
});

test('the macOS host script answers a framed request, whatever the paths and the browser pass', async () => {
  // A quote and a space in the path: each must stay one sh word.
  const dir = path.join(tempDir(), "it's a dir");
  fs.mkdirSync(dir);
  const bridgeFile = path.join(dir, 'bridge.json');
  const bridge = { port: 41234, secret: 'ab'.repeat(32), extensionVersion: '1.0.0' };
  writeBridge(bridgeFile, bridge);
  const script = path.join(dir, 'host.sh');
  fs.writeFileSync(script, hostScript({ exe: process.execPath, script: HOST, bridgeFile }), {
    mode: 0o755,
  });
  // Chrome appends the calling origin as an argument; the script must not pass it on.
  const origin = 'chrome-extension://hknnjgdhokbapjodjklfodhobjekjlnn/';
  assert.deepEqual(await askHost(bridgeFile, {}, script, [origin]), { code: 0, reply: bridge });
});
