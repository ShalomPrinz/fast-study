const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { afterEach, test } = require('node:test');

const {
  bundlePath,
  downloadVerified,
  launchHelper,
  pickZip,
  stageUpdate,
} = require('../macUpdate');

let dirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-update-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const BODY = Buffer.from('a zip, as far as the hash cares');
const SHA512 = createHash('sha512').update(BODY).digest('base64');
const serve = (requests = []) => {
  return async (url) => {
    requests.push(url);
    return new Response(BODY);
  };
};
const feed = (sha512 = SHA512) => [
  { url: new URL('https://feed.test/FastStudy-mac-arm64.dmg'), info: { sha512: 'dmg' } },
  { url: new URL('https://feed.test/FastStudy-mac-arm64.zip'), info: { sha512 } },
];

test('bundlePath is three levels above the binary, and refuses anything that is no .app', () => {
  assert.equal(
    bundlePath('/Applications/FastStudy.app/Contents/MacOS/FastStudy'),
    '/Applications/FastStudy.app',
  );
  assert.throws(() => bundlePath('/opt/faststudy/bin/faststudy'), /not running from an \.app/);
});

test('pickZip takes the zip, never the dmg, and refuses a feed without one or without its hash', () => {
  assert.equal(pickZip(feed()).url.pathname, '/FastStudy-mac-arm64.zip');
  assert.throws(() => pickZip(feed().slice(0, 1)), /lists no \.zip/);
  assert.throws(() => pickZip(feed(null)), /no sha512/);
});

test('a download whose sha512 matches the feed is kept', async () => {
  const dest = path.join(tempDir(), 'update.zip');
  await downloadVerified({ url: 'https://feed.test/x.zip', sha512: SHA512, dest, fetch: serve() });
  assert.deepEqual(fs.readFileSync(dest), BODY);
});

test('a download whose sha512 differs is deleted and refused', async () => {
  const dest = path.join(tempDir(), 'update.zip');
  const wrong = createHash('sha512').update('something else').digest('base64');
  await assert.rejects(
    downloadVerified({ url: 'https://feed.test/x.zip', sha512: wrong, dest, fetch: serve() }),
    /sha512 mismatch/,
  );
  assert.equal(fs.existsSync(dest), false);
});

test('a download the feed refuses is an error, not an empty file', async () => {
  const dest = path.join(tempDir(), 'update.zip');
  const fetch = async () => new Response('gone', { status: 404 });
  await assert.rejects(
    downloadVerified({ url: 'https://feed.test/x.zip', sha512: SHA512, dest, fetch }),
    /answered 404/,
  );
});

test('stageUpdate verifies before it unpacks, clears an earlier try, and answers the staged app', async () => {
  const root = tempDir();
  const dir = path.join(root, 'update');
  fs.mkdirSync(path.join(dir, 'staged', 'Stale.app'), { recursive: true });
  const requests = [];
  const order = [];
  const staged = await stageUpdate({
    files: feed(),
    dir,
    bundle: path.join(root, 'FastStudy.app'),
    fetch: serve(requests),
    unzip: async (zip, target) => {
      order.push(`unzip ${fs.readFileSync(zip).equals(BODY)}`);
      fs.mkdirSync(path.join(target, 'FastStudy.app'));
    },
  });
  assert.deepEqual(requests, ['https://feed.test/FastStudy-mac-arm64.zip']);
  assert.deepEqual(order, ['unzip true']);
  assert.equal(staged, path.join(dir, 'staged', 'FastStudy.app'));
  assert.deepEqual(fs.readdirSync(dir), ['staged']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'staged')), ['FastStudy.app']);
});

test('stageUpdate never unpacks a download that fails its sha512', async () => {
  const root = tempDir();
  await assert.rejects(
    stageUpdate({
      files: feed('bm90IHRoZSBoYXNo'),
      dir: path.join(root, 'update'),
      bundle: path.join(root, 'FastStudy.app'),
      fetch: serve(),
      unzip: () => assert.fail('unpacked'),
    }),
    /sha512 mismatch/,
  );
  assert.equal(fs.existsSync(path.join(root, 'update')), false);
});

test('stageUpdate leaves no zip and no half-unpacked bundle behind a failed unpack', async () => {
  const root = tempDir();
  await assert.rejects(
    stageUpdate({
      files: feed(),
      dir: path.join(root, 'update'),
      bundle: path.join(root, 'FastStudy.app'),
      fetch: serve(),
      unzip: async (zip, target) => {
        fs.mkdirSync(path.join(target, 'FastStudy.app'));
        throw new Error('ditto died');
      },
    }),
    /ditto died/,
  );
  assert.equal(fs.existsSync(path.join(root, 'update')), false);
});

test('stageUpdate refuses a bundle it could not swap before downloading anything', async (t) => {
  // Root ignores the mode bits this test denies itself with.
  if (process.getuid() === 0) return t.skip('running as root');
  const root = tempDir();
  const locked = path.join(root, 'readonly');
  fs.mkdirSync(locked, { mode: 0o555 });
  await assert.rejects(
    stageUpdate({
      files: feed(),
      dir: path.join(root, 'update'),
      bundle: path.join(locked, 'FastStudy.app'),
      fetch: () => assert.fail('downloaded'),
      unzip: () => assert.fail('unpacked'),
    }),
    /EACCES/,
  );
});

test('stageUpdate refuses a zip with no .app in it', async () => {
  const root = tempDir();
  await assert.rejects(
    stageUpdate({
      files: feed(),
      dir: path.join(root, 'update'),
      bundle: path.join(root, 'FastStudy.app'),
      fetch: serve(),
      unzip: async () => {},
    }),
    /holds no \.app/,
  );
});

/** An installed build, a staged one, a live "app" process and a fake `open` (and any other fake
 *  tool) ahead of the real ones on PATH. */
function install(fakes = {}) {
  const root = tempDir();
  const bundle = path.join(root, 'Applications', 'FastStudy.app');
  const staged = path.join(root, 'state', 'update', 'staged', 'FastStudy.app');
  for (const [dir, build] of [
    [bundle, 'old'],
    [staged, 'new'],
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'build'), build);
  }
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const opened = path.join(root, 'opened');
  const tools = { open: `#!/bin/sh\necho "$1" > '${opened}'\n`, ...fakes };
  for (const [name, script] of Object.entries(tools)) {
    fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 });
  }
  const running = spawn('sleep', ['60'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => running.on('exit', resolve));
  const logFile = path.join(root, 'state', 'logs', 'update.log');
  const start = (relaunch, polls) =>
    launchHelper({
      pid: running.pid,
      bundle,
      staged,
      relaunch,
      logFile,
      polls,
      env: { PATH: `${bin}:${process.env.PATH}` },
    });
  const build = () => fs.readFileSync(path.join(bundle, 'build'), 'utf8');
  // The log without its timestamps, once the helper has written `last`.
  const lines = async (last) => {
    for (let waited = 0; waited < 10_000; waited += 20) {
      const text = fs.readFileSync(logFile, 'utf8');
      const found = text
        .split('\n')
        .filter(Boolean)
        .map((line) => line.replace(/^.*\[update\] /, ''));
      if (found.some((line) => line.startsWith(last))) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no "${last}" in ${fs.readFileSync(logFile, 'utf8')}`);
  };
  const stop = () => {
    running.kill('SIGKILL');
    return exited;
  };
  return { bundle, staged, opened, running, start, build, lines, stop };
}

test('the helper swaps only after the app has exited, then relaunches it', async () => {
  const { bundle, staged, opened, running, start, build, lines, stop } = install();
  start(true);
  assert.deepEqual(await lines('waiting'), [`waiting for pid ${running.pid} to exit`]);
  // Several of the helper's polls later the app is still up, and nothing has moved.
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(build(), 'old');
  assert.equal(fs.existsSync(staged), true);
  await stop();
  assert.deepEqual(await lines('relaunching'), [
    `waiting for pid ${running.pid} to exit`,
    `pid ${running.pid} exited`,
    `swapping ${bundle}`,
    `swapped: ${bundle} is the new build`,
    `relaunching ${bundle}`,
  ]);
  assert.equal(build(), 'new');
  assert.equal(fs.existsSync(staged), false);
  assert.deepEqual(fs.readdirSync(path.dirname(bundle)), ['FastStudy.app']);
  for (let waited = 0; !fs.existsSync(opened) && waited < 5000; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.readFileSync(opened, 'utf8').trim(), bundle);
});

test('a quit-time install swaps without relaunching', async () => {
  const { bundle, opened, start, build, lines, stop } = install();
  start(false);
  await stop();
  const log = await lines('not relaunching');
  assert.deepEqual(log.slice(-2), [`swapped: ${bundle} is the new build`, 'not relaunching']);
  assert.equal(build(), 'new');
  assert.equal(fs.existsSync(opened), false);
});

test('a swap that fails half way puts the previous build back and still relaunches', async () => {
  // Fails the one move that puts the new build in place: its source is the hidden `.new` sibling.
  const mv = '#!/bin/sh\ncase "$1" in *.app.new) exit 1 ;; esac\nexec /bin/mv "$@"\n';
  const { bundle, start, build, lines, stop } = install({ mv });
  start(true);
  await stop();
  const log = await lines('relaunching');
  assert.deepEqual(log.slice(-2), [
    'swap failed: restored the previous build',
    `relaunching ${bundle}`,
  ]);
  assert.equal(build(), 'old');
  assert.deepEqual(fs.readdirSync(path.dirname(bundle)), ['FastStudy.app']);
});

test('a previous build that cannot be put back is reported where it was left, with no relaunch', async () => {
  // Fails both the move into place and the move back.
  const mv = '#!/bin/sh\ncase "$1" in *.app.new|*.app.old) exit 1 ;; esac\nexec /bin/mv "$@"\n';
  const { bundle, staged, opened, start, lines, stop } = install({ mv });
  const previous = path.join(path.dirname(bundle), '.FastStudy.app.old');
  start(true);
  await stop();
  const log = await lines('swap failed');
  assert.deepEqual(log.slice(-1), [
    `swap failed: could not restore the previous build, it is left at ${previous}`,
  ]);
  assert.equal(fs.readFileSync(path.join(previous, 'build'), 'utf8'), 'old');
  // The helper's last steps follow that line; give them time before reading what they left.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(fs.readdirSync(path.dirname(bundle)), ['.FastStudy.app.old']);
  assert.equal(fs.existsSync(staged), false);
  assert.equal(fs.existsSync(opened), false);
});

test('a helper whose app never exits gives up, drops the staged build and does not relaunch', async () => {
  const { staged, opened, running, start, build, lines, stop } = install();
  start(true, 2);
  const log = await lines('gave up');
  assert.deepEqual(log, [
    `waiting for pid ${running.pid} to exit`,
    `gave up: pid ${running.pid} is still running, nothing swapped, not relaunching`,
  ]);
  for (let waited = 0; fs.existsSync(staged) && waited < 5000; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(staged), false);
  assert.equal(build(), 'old');
  assert.equal(fs.existsSync(opened), false);
  await stop();
});
