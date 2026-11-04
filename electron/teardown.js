const childProcess = require('node:child_process');

/** Ask every child to stop, synchronously so an exit handler can call it. Returns the POSIX children
 *  still to reap; Windows returns none, since `taskkill /F` has already forced the whole tree. */
function signalChildren(children, log) {
  const signalled = [];
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    try {
      if (process.platform === 'win32') {
        const result = childProcess.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          encoding: 'utf8',
        });
        // Logged only: a refusal (e.g. a protected image name) leaves the tree running, unseen otherwise.
        if (result.status !== 0) {
          const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
          log(
            `taskkill pid ${child.pid} failed (exit ${result.status ?? result.error?.message}): ${output}`,
          );
        }
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

/** What a child's exit means. Unlisted: main's own kill, nothing to do. Listed while booting: the
 *  boot's failure, onto the launch screen, port or no port. Listed after it: a death the window hears of. */
function exitKind({ listed, booting }) {
  if (!listed) return null;
  return booting ? 'boot' : 'stopped';
}

module.exports = { signalChildren, reapChildren, exitKind };
