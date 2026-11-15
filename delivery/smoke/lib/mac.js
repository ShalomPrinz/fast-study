import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appExe, resultsDir, workDir } from './paths.js';

// The group smoke-suite-mac.yml's pf anchor blocks outbound for, bar loopback.
export const OFFLINE_GROUP = 'no_inet';

/** `[file, args]` re-run as the runner under the offline group's primary gid (`sudo -g` sets real and
 *  effective gid, which pf matches and children inherit). `-E` keeps the app's environment. */
export function offlineArgv(file, args) {
  const user = os.userInfo().username;
  return ['/usr/bin/sudo', ['-n', '-E', '-u', user, '-g', OFFLINE_GROUP, '--', file, ...args]];
}

/** An executable that starts the installed app offline: Playwright's `executablePath`, which puts its
 *  own arguments before ours, so the app path is baked in rather than passed. */
export function offlineAppLauncher() {
  const [sudo, args] = offlineArgv(appExe(), []);
  const file = path.join(workDir(), 'offline-app.sh');
  fs.mkdirSync(workDir(), { recursive: true });
  const quoted = args.map((arg) => `'${arg}'`).join(' ');
  fs.writeFileSync(file, `#!/bin/bash\nexec ${sudo} ${quoted} "$@"\n`, { mode: 0o755 });
  return file;
}

/** Spawn in its own process group and collect output; `timeoutMs` kills the group, since the
 *  root-owned `sudo` parent of an offline run cannot be signalled alone but the runner-owned app can. */
function launch(file, args, { timeoutMs, env, offline }) {
  const [command, argv] = offline ? offlineArgv(file, args) : [file, args];
  const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], env, detached: true });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, timeoutMs);
  const done = new Promise((resolve) => {
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: error.code ?? 'failed', stdout, stderr, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 'failed', stdout, stderr, timedOut });
    });
  });
  return done;
}

/** Run a program to exit, answering its exit code and output; `offline` runs it under the offline
 *  group, and `timeoutMs` elapsing throws `onTimeout`. */
export async function runToExit(file, args, { timeoutMs, onTimeout, env, offline = false } = {}) {
  const result = await launch(file, args, { timeoutMs, env, offline });
  if (result.timedOut) {
    throw new Error(onTimeout ?? `${file} did not exit within ${timeoutMs / 1000}s`);
  }
  if (typeof result.code === 'string') throw new Error(`${file}: ${result.code}`);
  return { code: result.code, output: result.stdout + result.stderr };
}

/** Run `file` to its exit, never throwing on a non-zero one: `{ code, stdout, stderr }`. */
export async function run(file, args, { timeoutMs = 120_000, env, offline = false } = {}) {
  const result = await launch(file, args, { timeoutMs, env: env ?? process.env, offline });
  return {
    code: result.timedOut ? 'timeout' : result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** `run`, as one line of what was run and everything it printed — the shape evidence quotes. */
export async function shown(file, args, options) {
  const { code, stdout, stderr } = await run(file, args, options);
  const text = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return {
    code,
    text: `$ ${[path.basename(file), ...args].join(' ')}  (exit ${code})\n${text || '(no output)'}`,
  };
}

/** Record what a check observed in `mac-evidence.md`, which the workflow puts in the run summary
 *  whatever the outcome; the job log stays clean. */
export function evidence(title, text) {
  fs.mkdirSync(resultsDir(), { recursive: true });
  fs.appendFileSync(
    path.join(resultsDir(), 'mac-evidence.md'),
    `### ${title}\n\n\`\`\`\n${text}\n\`\`\`\n\n`,
  );
}

/** A screenshot of the runner's desktop, for a boot that hangs on a system prompt. */
export async function screenshot(name) {
  const file = path.join(resultsDir(), name);
  fs.mkdirSync(resultsDir(), { recursive: true });
  await run('/usr/sbin/screencapture', ['-x', file], { timeoutMs: 30_000 });
  return file;
}

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(.*)$/;

/** Every live process with its parent and start time, in the shape `lib/windows.js` answers: `exe` is
 *  `ps`'s `comm` (the path it was executed by), `created` the ISO start time at one-second resolution,
 *  so a pid plus `created` names one process even after the pid is reused. Zombies are not processes. */
export async function processTable() {
  const [rows, comms] = await Promise.all([
    run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,stat=,lstart=,command=']),
    run('/bin/ps', ['-axww', '-o', 'pid=,comm=']),
  ]);
  const exeOf = new Map();
  for (const line of comms.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) exeOf.set(Number(m[1]), m[2].trim());
  }
  const table = [];
  for (const line of rows.stdout.split('\n')) {
    const m = PS_ROW.exec(line);
    if (!m || m[3].startsWith('Z')) continue;
    const pid = Number(m[1]);
    const commandLine = m[5];
    const comm = exeOf.get(pid) ?? '';
    const exe = comm.startsWith('/') ? comm : (/^\S+/.exec(commandLine)?.[0] ?? '');
    table.push({
      pid,
      ppid: Number(m[2]),
      name: path.basename(exe),
      exe,
      commandLine,
      created: new Date(m[4]).toISOString(),
    });
  }
  return table;
}

/** Live processes whose executable sits under any of `dirs`, or whose command line carries a
 *  Playwright browser profile. By executable, never command line: the root `sudo` parent of an
 *  offline run names the bundle in its arguments and is not the app. */
export async function strayProcesses(dirs) {
  const prefixes = dirs.map((dir) => path.join(dir, path.sep));
  return (await processTable())
    .filter(
      (p) =>
        prefixes.some((prefix) => p.exe.startsWith(prefix)) ||
        p.commandLine.includes('playwright_chromiumdev_profile'),
    )
    .map((p) => ({ ProcessId: p.pid, Name: p.name, ExecutablePath: p.exe }));
}

/** The pid listening on each of `ports` on any address, as `{ port, pid }`; a free port has no row.
 *  lsof sees only this user's sockets, which the runner-owned services are. */
export async function listeners(ports) {
  const { stdout } = await run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']);
  const found = [];
  let pid = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) {
      const port = Number(line.slice(line.lastIndexOf(':') + 1));
      if (ports.includes(port) && !found.some((f) => f.port === port && f.pid === pid)) {
        found.push({ port, pid });
      }
    }
  }
  return found;
}

/** Processes whose image name matches a glob in `patterns`, as `{ Id, ProcessName }`. */
export async function processesNamed(patterns) {
  const regexes = patterns.map(
    (pattern) =>
      new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'),
  );
  return (await processTable())
    .filter((p) => regexes.some((re) => re.test(p.name)))
    .map((p) => ({ Id: p.pid, ProcessName: p.name }));
}

export async function stopProcesses(names) {
  for (const name of names) await run('/usr/bin/pkill', ['-KILL', '-x', name]);
}

/** Rename `dir` to a sibling the caller restores, answering the new path. A directory entry rename
 *  needs write on the parent; App Management (TCC) may still refuse it for a signed `.app`, which throws here. */
export async function renameAside(dir) {
  const aside = `${dir}.faststudy-smoke`;
  try {
    fs.renameSync(dir, aside);
  } catch (error) {
    throw new Error(`could not rename ${dir} aside: ${error.message}`);
  }
  return aside;
}

/** SIGKILL one process by pid, in the shape of `lib/windows.js`'s: exit code 0 on success. */
export async function forceKill(pid) {
  try {
    process.kill(pid, 'SIGKILL');
    return { code: 0, output: '' };
  } catch (error) {
    return { code: 1, output: error.message };
  }
}
