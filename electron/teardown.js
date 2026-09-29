const { spawnSync } = require('node:child_process');

/** Ask every child to stop, synchronously so an exit handler can call it. Returns the POSIX children
 *  still to reap; Windows returns none, since `taskkill /F` has already forced the whole tree. */
function signalChildren(children) {
  const signalled = [];
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } else {
        // Negative pid: the child's whole process group, which is why they are spawned detached.
        process.kill(-child.pid, 'SIGTERM');
        signalled.push(child);
      }
    } catch {
      // Already gone, which is the outcome we wanted.
    }
  }
  return signalled;
}

/** Wait up to `graceMs` for each signalled child to exit, then SIGKILL its group — a child that
 *  ignores SIGTERM, or a tool it spawned that does, would otherwise outlive the app. */
function reapChildren(children, graceMs, log) {
  return Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          const force = () => {
            clearTimeout(timer);
            if (child.exitCode === null && child.signalCode === null) {
              log(`pid ${child.pid} ignored SIGTERM for ${graceMs}ms — SIGKILL`);
            }
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              // The group emptied on SIGTERM.
            }
            resolve();
          };
          const timer = setTimeout(force, graceMs);
          if (child.exitCode !== null || child.signalCode !== null) force();
          else child.once('exit', force);
        }),
    ),
  );
}

module.exports = { signalChildren, reapChildren };
