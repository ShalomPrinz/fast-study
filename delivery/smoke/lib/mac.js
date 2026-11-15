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

/** Record what a check observed: printed to the job log, and appended to `mac-evidence.md`, which
 *  the workflow puts in the run summary whatever the outcome. */
export function evidence(title, text) {
  console.log(`\n=== ${title} ===\n${text}\n`);
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
