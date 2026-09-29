const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
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
    await reapChildren(signalChildren([child]), 3000, () => assert.fail('no SIGKILL expected'));
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
    await reapChildren(signalChildren([child]), 500, (line) => lines.push(line));
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
  assert.deepEqual(signalChildren([{ pid: 1, exitCode: 0, signalCode: null }]), []);
});
