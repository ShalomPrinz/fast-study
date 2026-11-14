const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { afterEach, test } = require('node:test');

const {
  applicationsDirs,
  inApplications,
  offerMove,
  relaunchFrom,
  targetDir,
} = require('../macMove');

let dirs = [];
const tempDir = () => {
  // Resolved, so a symlinked temp folder (macOS's `/var`) does not change the paths a test expects.
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-move-')));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const build = (bundle) => fs.readFileSync(path.join(bundle, 'build'), 'utf8');
const makeBundle = (bundle, name) => {
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, 'build'), name);
};

/** A machine: the app in Downloads, a writable `/Applications` stand-in, no `~/Applications` yet, and
 *  every seam recorded. `over` replaces seams or options. */
function machine(over = {}) {
  const root = tempDir();
  const bundle = path.join(root, 'Downloads', 'FastStudy.app');
  makeBundle(bundle, 'new');
  const folders = {
    system: path.join(root, 'Applications'),
    user: path.join(root, 'home', 'Apps'),
  };
  fs.mkdirSync(folders.system);
  const calls = { asked: [], told: [], relaunched: [], trashed: [], lines: [] };
  const run = () =>
    offerMove({
      bundle,
      home: path.join(root, 'home'),
      pid: 4242,
      dirs: folders,
      log: (line) => calls.lines.push(line),
      ask: async (dir) => (calls.asked.push(dir), true),
      tell: async (target) => void calls.told.push(target),
      copy: async (source, dest) => fs.cpSync(source, dest, { recursive: true }),
      running: () => false,
      relaunch: (options) => void calls.relaunched.push(options),
      trash: async (item) => void calls.trashed.push(item),
      ...over,
    });
  return { bundle, folders, calls, run };
}

test('only /Applications and ~/Applications, and anything under them, count as Applications', () => {
  const folders = applicationsDirs('/Users/dana');
  assert.deepEqual(folders, { system: '/Applications', user: '/Users/dana/Applications' });
  for (const bundle of [
    '/Applications/FastStudy.app',
    '/Applications/Study/FastStudy.app',
    '/Users/dana/Applications/FastStudy.app',
  ]) {
    assert.equal(inApplications(bundle, folders), true, bundle);
  }
  for (const bundle of [
    '/Volumes/FastStudy/FastStudy.app',
    '/Users/dana/Downloads/FastStudy.app',
    '/private/var/folders/x/T/AppTranslocation/1B2C/d/FastStudy.app',
    '/Applications Backup/FastStudy.app',
    '/Volumes/Data/Applications/FastStudy.app',
  ]) {
    assert.equal(inApplications(bundle, folders), false, bundle);
  }
});

test('the target is the machine folder when writable, else the user one, and nothing is created', () => {
  const root = tempDir();
  const folders = {
    system: path.join(root, 'Applications'),
    user: path.join(root, 'home', 'Apps'),
  };
  assert.equal(targetDir(folders), folders.user);
  fs.mkdirSync(folders.system);
  assert.equal(targetDir(folders), folders.system);
  assert.equal(fs.existsSync(folders.user), false);
});

test('an app already in Applications is not asked', async () => {
  const root = tempDir();
  const folders = {
    system: path.join(root, 'Applications'),
    user: path.join(root, 'home', 'Apps'),
  };
  const lines = [];
  const moved = await offerMove({
    bundle: path.join(folders.user, 'FastStudy.app'),
    home: path.join(root, 'home'),
    pid: 1,
    dirs: folders,
    log: (line) => lines.push(line),
    ask: () => assert.fail('asked'),
  });
  assert.equal(moved, false);
  assert.deepEqual(lines, []);
});

/** A home reached through a symlink, as `app.getPath('home')` reports it, beside the real folder
 *  `process.execPath` names. No `/Applications` stand-in, so every move targets the user folder. */
function linkedHome() {
  const root = tempDir();
  const realHome = path.join(root, 'volume', 'dana');
  fs.mkdirSync(realHome, { recursive: true });
  const home = path.join(root, 'dana');
  fs.symlinkSync(realHome, home);
  const folders = {
    system: path.join(root, 'Applications'),
    user: path.join(home, 'Applications'),
  };
  return { realHome, home, folders };
}

test('an app in ~/Applications is not asked when the home folder is a symlink', async () => {
  const { realHome, home, folders } = linkedHome();
  const bundle = path.join(realHome, 'Applications', 'FastStudy.app');
  makeBundle(bundle, 'installed');
  const { calls, run } = machine({
    bundle,
    home,
    dirs: folders,
    ask: () => assert.fail('asked'),
    copy: () => assert.fail('copied'),
  });
  assert.equal(await run(), false);
  assert.equal(build(bundle), 'installed');
  assert.deepEqual(fs.readdirSync(path.dirname(bundle)), ['FastStudy.app']);
  assert.deepEqual([calls.relaunched, calls.trashed, calls.lines], [[], [], []]);
});

test('a move into a symlinked home lands in the real ~/Applications, created on the yes', async () => {
  const { realHome, home, folders } = linkedHome();
  const { bundle, calls, run } = machine({ home, dirs: folders });
  const target = path.join(realHome, 'Applications', 'FastStudy.app');
  assert.equal(await run(), true);
  assert.deepEqual(calls.asked, [folders.user]);
  assert.equal(build(target), 'new');
  assert.deepEqual(calls.relaunched, [{ pid: 4242, target }]);
  assert.deepEqual(calls.trashed, [bundle]);
});

test('a target that is the running bundle is never asked about, copied over or trashed', async () => {
  const { realHome, home, folders } = linkedHome();
  const { bundle, calls, run } = machine({
    home,
    dirs: folders,
    ask: () => assert.fail('asked'),
    copy: () => assert.fail('copied'),
  });
  // The one way left to reach it: the Applications entry is itself a link to the running bundle.
  const apps = path.join(realHome, 'Applications');
  fs.mkdirSync(apps);
  fs.symlinkSync(bundle, path.join(apps, 'FastStudy.app'));
  assert.equal(await run(), false);
  assert.equal(build(bundle), 'new');
  assert.deepEqual(fs.readdirSync(apps), ['FastStudy.app']);
  assert.equal(fs.lstatSync(path.join(apps, 'FastStudy.app')).isSymbolicLink(), true);
  assert.deepEqual([calls.relaunched, calls.trashed], [[], []]);
  assert.deepEqual(calls.lines, [
    `not moved to Applications: ${path.join(apps, 'FastStudy.app')} is the running app`,
  ]);
});

test('a yes copies the app into Applications, starts the relaunch and trashes the original', async () => {
  const { bundle, folders, calls, run } = machine();
  const target = path.join(folders.system, 'FastStudy.app');
  assert.equal(await run(), true);
  assert.deepEqual(calls.asked, [folders.system]);
  assert.equal(build(target), 'new');
  assert.deepEqual(fs.readdirSync(folders.system), ['FastStudy.app']);
  assert.deepEqual(calls.relaunched, [{ pid: 4242, target }]);
  assert.deepEqual(calls.trashed, [bundle]);
  assert.deepEqual(calls.lines, [`moved to ${target} — quitting to reopen from there`]);
});

test('an unwritable /Applications sends the move to ~/Applications, created on the yes', async () => {
  const { folders, calls, run } = machine();
  fs.rmdirSync(folders.system);
  assert.equal(await run(), true);
  assert.deepEqual(calls.asked, [folders.user]);
  assert.equal(build(path.join(folders.user, 'FastStudy.app')), 'new');
});

test('a no moves nothing, creates nothing and boots on', async () => {
  const { bundle, folders, calls, run } = machine({ ask: async () => false });
  fs.rmdirSync(folders.system);
  assert.equal(await run(), false);
  assert.equal(fs.existsSync(folders.user), false);
  assert.deepEqual(calls.relaunched, []);
  assert.deepEqual(calls.trashed, []);
  assert.deepEqual(calls.lines, [`move to Applications declined — running from ${bundle}`]);
});

test('a copy already in Applications is replaced, with nothing left beside it', async () => {
  const { folders, run } = machine();
  const target = path.join(folders.system, 'FastStudy.app');
  makeBundle(target, 'old');
  fs.writeFileSync(path.join(target, 'only-in-old'), '');
  assert.equal(await run(), true);
  assert.equal(build(target), 'new');
  assert.deepEqual(fs.readdirSync(target), ['build']);
  assert.deepEqual(fs.readdirSync(folders.system), ['FastStudy.app']);
});

test('a running copy in Applications is left alone: the user is told and the boot goes on', async () => {
  const { folders, calls, run } = machine({
    running: (target) => target === path.join(folders.system, 'FastStudy.app'),
    copy: () => assert.fail('copied'),
  });
  const target = path.join(folders.system, 'FastStudy.app');
  makeBundle(target, 'old');
  assert.equal(await run(), false);
  assert.equal(build(target), 'old');
  assert.deepEqual(calls.told, [target]);
  assert.deepEqual(calls.relaunched, []);
  assert.deepEqual(calls.lines, [`not moved to Applications: ${target} is running`]);
});

test('a failed copy keeps the installed copy, leaves no partial one and boots on', async () => {
  const { folders, calls, run } = machine({
    copy: async (source, dest) => {
      fs.mkdirSync(dest);
      throw new Error('ditto died');
    },
  });
  const target = path.join(folders.system, 'FastStudy.app');
  makeBundle(target, 'old');
  assert.equal(await run(), false);
  assert.equal(build(target), 'old');
  assert.deepEqual(fs.readdirSync(folders.system), ['FastStudy.app']);
  assert.deepEqual(calls.relaunched, []);
  assert.deepEqual(calls.trashed, []);
  assert.deepEqual(calls.lines, ['not moved to Applications: ditto died']);
});

test('a dialog or a relaunch that throws is logged and never fails the boot', async () => {
  const asked = machine({
    ask: async () => {
      throw new Error('no display');
    },
  });
  assert.equal(await asked.run(), false);
  assert.deepEqual(asked.calls.lines, ['not moved to Applications: no display']);

  const relaunched = machine({
    relaunch: () => {
      throw new Error('spawn EAGAIN');
    },
  });
  assert.equal(await relaunched.run(), false);
  // The original is what keeps running, so it is not trashed.
  assert.deepEqual(relaunched.calls.trashed, []);
  assert.deepEqual(relaunched.calls.lines, ['not moved to Applications: spawn EAGAIN']);
});

test('an original that cannot be trashed still counts as moved', async () => {
  const { bundle, calls, run } = machine({
    trash: async () => {
      throw new Error('read-only volume');
    },
  });
  assert.equal(await run(), true);
  assert.equal(calls.lines[1], `the original stays at ${bundle}: read-only volume`);
});

test('the relaunch helper opens the moved app only once the old process has exited', async () => {
  const root = tempDir();
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const opened = path.join(root, 'opened');
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\necho "$1" > '${opened}'\n`, { mode: 0o755 });
  const running = spawn('sleep', ['60'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => running.on('exit', resolve));
  const target = path.join(root, 'Applications', "Fast Study's.app");
  relaunchFrom({ pid: running.pid, target, env: { PATH: `${bin}:${process.env.PATH}` } });
  // Several polls later the old process is still up, and nothing was opened.
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(fs.existsSync(opened), false);
  running.kill('SIGKILL');
  await exited;
  for (let waited = 0; !fs.existsSync(opened) && waited < 5000; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.readFileSync(opened, 'utf8').trim(), target);
});

test('the relaunch helper gives up on a process that never exits, opening nothing', async () => {
  const root = tempDir();
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const opened = path.join(root, 'opened');
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\necho "$1" > '${opened}'\n`, { mode: 0o755 });
  const helper = relaunchFrom({
    pid: process.pid,
    target: path.join(root, 'FastStudy.app'),
    polls: 2,
    env: { PATH: `${bin}:${process.env.PATH}` },
  });
  const gone = () => {
    try {
      process.kill(helper, 0);
      return false;
    } catch {
      return true;
    }
  };
  for (let waited = 0; !gone() && waited < 5000; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(gone(), true);
  assert.equal(fs.existsSync(opened), false);
});
