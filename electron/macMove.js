const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync, spawn } = require('node:child_process');

/** The two folders that count as Applications: the machine's and the user's own. */
function applicationsDirs(home) {
  return { system: '/Applications', user: path.join(home, 'Applications') };
}

/** `item` with every symlink on the way resolved, as `process.execPath` already is on macOS. A tail
 *  that does not exist yet — `~/Applications` before its first use — is kept as written. */
function resolved(item) {
  try {
    return fs.realpathSync.native(item);
  } catch {
    const parent = path.dirname(item);
    return parent === item ? item : path.join(resolved(parent), path.basename(item));
  }
}

/** Whether `a` and `b` are one item on disk, however each path spells it. False when either is missing. */
function sameItem(a, b) {
  try {
    const [one, other] = [a, b].map((item) => fs.statSync(item, { bigint: true }));
    return one.dev === other.dev && one.ino === other.ino;
  } catch {
    return false;
  }
}

/** Whether `bundle` already sits in, or anywhere under, one of `dirs`. */
function inApplications(bundle, dirs) {
  return Object.values(dirs).some((dir) => bundle.startsWith(dir + path.sep));
}

/** The folder a move goes to: the machine's when this user can write it, else the user's own, which
 *  needs no admin password. Creates nothing. */
function targetDir(dirs) {
  try {
    fs.accessSync(dirs.system, fs.constants.W_OK);
    return dirs.system;
  } catch {
    return dirs.user;
  }
}

/** The question, with no parent window: none exists this early in the boot. English, as the launch
 *  screen is. Answers whether the user chose the move. */
async function askToMove(dir) {
  const { app, dialog } = require('electron');
  // A first launch can leave Gatekeeper's own dialog holding the focus, and the alert behind it.
  app.focus({ steal: true });
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: 'Move FastStudy to Applications?',
    detail: `FastStudy can only update itself from an Applications folder. It will be moved to ${dir} and reopened.`,
    buttons: ['Move to Applications', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

/** Say why a chosen move did not happen: the copy already at `target` is running. */
async function tellRunning(target) {
  await require('electron').dialog.showMessageBox({
    type: 'info',
    message: 'FastStudy was not moved',
    detail: `Another copy is running from ${target}. Close it, then open FastStudy again to move it.`,
    buttons: ['OK'],
  });
}

// `--noqtn` leaves `com.apple.quarantine` off the copy: a quarantined copy the Finder did not move is
// translocated on the relaunch, which would ask for this same move again (docs/BOOT.md).
const ditto = (source, dest) =>
  new Promise((resolve, reject) => {
    execFile('/usr/bin/ditto', ['--noqtn', source, dest], (error) =>
      error ? reject(error) : resolve(),
    );
  });

/** Whether any process, of any user, runs out of the bundle at `target`. The single-instance lock
 *  already rules out this user's own, so this is another account's copy. */
function isRunning(target) {
  const commands = execFileSync('/bin/ps', ['-axww', '-o', 'comm='], { encoding: 'utf8' });
  return commands.split('\n').some((command) => command.trim().startsWith(target + path.sep));
}

/** Copy `bundle` to `target`, replacing a copy already there. The copy lands beside the target
 *  first, so a failure at any point leaves whatever was installed as it was. */
async function install({ bundle, target, copy = ditto }) {
  const dir = path.dirname(target);
  const incoming = path.join(dir, `.${path.basename(target)}.new`);
  const previous = path.join(dir, `.${path.basename(target)}.old`);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(incoming, { recursive: true, force: true });
  fs.rmSync(previous, { recursive: true, force: true });
  try {
    await copy(bundle, incoming);
    const existed = fs.existsSync(target);
    if (existed) fs.renameSync(target, previous);
    try {
      fs.renameSync(incoming, target);
    } catch (error) {
      if (existed) fs.renameSync(previous, target);
      throw error;
    }
  } catch (error) {
    fs.rmSync(incoming, { recursive: true, force: true });
    throw error;
  }
  try {
    fs.rmSync(previous, { recursive: true, force: true });
  } catch {
    // Another account's files can refuse the delete; the next move or update clears the leftover.
  }
}

/** Start the detached helper that opens `target` once `pid` is gone — before that, the new copy
 *  would lose the single-instance lock to this one and exit. It gives up after `polls` checks, five
 *  a second, opening nothing. Returns the helper's pid. */
function relaunchFrom({ pid, target, polls = 300, env = { PATH: '/usr/bin:/bin' } }) {
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      'n=0; while kill -0 "$1" 2>/dev/null; do n=$((n+1)); [ "$n" -ge "$3" ] && exit 1; sleep 0.2; done; exec open "$2"',
      'faststudy-move',
      String(pid),
      target,
      String(polls),
    ],
    { detached: true, stdio: 'ignore', env },
  );
  child.on('error', () => {});
  child.unref();
  return child.pid;
}

/** Offer to move the app at `bundle` into an Applications folder, and do it on a yes. Answers true
 *  when the move is done and the relaunch is pending, so the caller quits; false to boot from where
 *  the app is. Never throws: a failure is one `log(line)` and a false. */
async function offerMove({
  bundle: launched,
  home,
  pid,
  log,
  dirs = applicationsDirs(home),
  ask = askToMove,
  tell = tellRunning,
  copy = ditto,
  running = isRunning,
  relaunch = relaunchFrom,
  trash = (item) => require('electron').shell.trashItem(item),
}) {
  // Resolved on both sides: a symlinked home would otherwise hide that the app is already there.
  const bundle = resolved(launched);
  const real = Object.fromEntries(Object.entries(dirs).map(([key, dir]) => [key, resolved(dir)]));
  if (inApplications(bundle, real)) return false;
  try {
    const dir = targetDir(dirs);
    const target = path.join(resolved(dir), path.basename(bundle));
    // Replacing the running bundle with its own copy would end with that copy in the Trash.
    if (sameItem(target, bundle)) {
      log(`not moved to Applications: ${target} is the running app`);
      return false;
    }
    if (!(await ask(dir))) {
      log(`move to Applications declined — running from ${bundle}`);
      return false;
    }
    if (fs.existsSync(target) && running(target)) {
      log(`not moved to Applications: ${target} is running`);
      await tell(target);
      return false;
    }
    await install({ bundle, target, copy });
    relaunch({ pid, target });
    log(`moved to ${target} — quitting to reopen from there`);
    // Fails from a dmg or a translocated path, both read-only; the copy is in place either way.
    await trash(bundle).catch((error) => log(`the original stays at ${bundle}: ${error.message}`));
    return true;
  } catch (error) {
    log(`not moved to Applications: ${error.message}`);
    return false;
  }
}

module.exports = { applicationsDirs, inApplications, install, offerMove, relaunchFrom, targetDir };
