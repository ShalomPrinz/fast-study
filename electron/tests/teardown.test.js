const assert = require('node:assert/strict');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const { spawn } = childProcess;
const { test } = require('node:test');

const { reapChildren, signalChildren } = require('../teardown');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Members of process group `pgid` still able to run: a zombie stays in its group until its reaper collects it.
const liveMembers = (pgid) =>
  fs.readdirSync('/proc').filter((pid) => {
    let stat;
    try {
      stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      return false;
    }
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(pgrp) === pgid && state !== 'Z';
  });

// Detached, like main's children, so the group kill has a group to reach.
const spawnGroup = (script) => spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' });

test(
  'a child that exits on SIGTERM is reaped before the grace ends',
  { skip: process.platform === 'win32' },
  async () => {
    const child = spawnGroup('sleep 60');
    const started = Date.now();
    await reapChildren(signalChildren([child], assert.fail), 3000, () =>
      assert.fail('no SIGKILL expected'),
    );
    assert.ok(Date.now() - started < 1000);
    assert.equal(alive(child.pid), false);
  },
);

test(
  'a group that ignores SIGTERM is SIGKILLed once the grace ends',
  { skip: process.platform !== 'linux' },
  async () => {
    // The grandchild inherits the ignored SIGTERM, as a tool spawned by a hung service would.
    const child = spawnGroup("trap '' TERM; sleep 60 & wait");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const lines = [];
    const started = Date.now();
    await reapChildren(signalChildren([child], assert.fail), 500, (line) => lines.push(line));
    assert.ok(Date.now() - started >= 500);
    assert.equal(lines.length, 1);
    assert.equal(
      child.signalCode ?? (await new Promise((r) => child.once('exit', (_c, s) => r(s)))),
      'SIGKILL',
    );
    // SIGKILL is delivered but not yet acted on for a moment, so allow the group that long to die.
    for (let i = 0; i < 100 && liveMembers(child.pid).length; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual(liveMembers(child.pid), []);
  },
);

test('an already-exited child is skipped', () => {
  assert.deepEqual(signalChildren([{ pid: 1, exitCode: 0, signalCode: null }], assert.fail), []);
});

test('a refused taskkill is logged with its exit status and output', (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', platform));
  const refusal = 'ERROR: The process with PID 42 could not be terminated.';
  t.mock.method(childProcess, 'spawnSync', () => ({
    status: 128,
    stdout: '',
    stderr: `${refusal}\r\n`,
  }));
  const lines = [];
  assert.deepEqual(
    signalChildren([{ pid: 42, exitCode: null, signalCode: null }], (l) => lines.push(l)),
    [],
  );
  assert.deepEqual(lines, [`taskkill pid 42 failed (exit 128): ${refusal}`]);
});

test('an exit is news only when main did not cause it, and fails the boot while one runs', () => {
  const { exitKind } = require('../teardown');
  assert.equal(exitKind({ listed: true, booting: false }), 'stopped');
  // A quit, teardown or restart unlisted the child before signalling it.
  assert.equal(exitKind({ listed: false, booting: false }), null);
  assert.equal(exitKind({ listed: false, booting: true }), null);
  // Dying mid-boot, before or after its port line, fails the boot onto the launch screen's failure view.
  assert.equal(exitKind({ listed: true, booting: true }), 'boot');
});
