// Starting the fakes and the five dev processes, waiting for each to answer, and killing the lot.
// Every child gets its own process group, so teardown reaps what a service spawned too — a
// uvicorn worker, vite's esbuild, a download still running.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BANNER } from './env.mjs';

const children = [];

/** Spawn one child, its output appended to `<logs>/<name>.log` under the harness banner. */
export function start(name, command, args, { cwd, env, paths }) {
  const logFile = path.join(paths.logs, `${name}.log`);
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.writeFileSync(logFile, `# ${BANNER}\n# ${command} ${args.join(' ')}\n`);
  const handle = fs.openSync(logFile, 'a');
  const child = spawn(command, args, {
    cwd,
    env: { ...env, HUNT_BUGS_SERVICE: name },
    stdio: ['ignore', handle, handle],
    detached: true,
  });
  child.unref();
  children.push({ name, child, logFile });
  return child;
}

/** Poll a URL until it answers 2xx, or fail naming the log that says why it never did. */
export async function waitFor(name, url, { timeoutMs = 90_000, logFile } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.cause?.code ?? error.message;
    }
    await sleep(400);
  }
  const tail =
    logFile && fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-25).join('\n')
      : '';
  throw new Error(`${name} never answered ${url} (${lastError})\n--- ${logFile} ---\n${tail}`);
}

/** The log file a started child writes to, for an error message that has to name it. */
export function logOf(name) {
  return children.find((entry) => entry.name === name)?.logFile;
}

/** Kill every child's process group. Safe to call twice; a child that already died is skipped. */
export function stopAll() {
  for (const { child } of children.splice(0)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
  }
}

// Who is listening on one of our ports, as `{ port, pid, command }`. A previous harness, or a
// plain `npm run dev`, holds exactly these — and a run that quietly attached to one would test a
// stack configured for somebody else's data root.
export function portOwners(ports) {
  const owners = [];
  for (const [name, port] of Object.entries(ports)) {
    let line;
    try {
      line = execFileSync('ss', ['-lptnH', `sport = :${port}`], { encoding: 'utf8' });
    } catch {
      continue;
    }
    const pid = /pid=(\d+)/.exec(line)?.[1];
    if (!pid) continue;
    let command = 'unknown';
    try {
      command = fs
        .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
        .split('\0')
        .filter(Boolean)
        .join(' ');
    } catch {}
    owners.push({ name, port, pid: Number(pid), command });
  }
  return owners;
}

// Only what this harness or `npm run dev` starts may be stopped by --stop; anything else on the
// port is somebody's own process and the run refuses instead.
const OURS = /uvicorn|backend_main|database_main|src\/index\.js|app\.js|vite|hunt-bugs/;

/** SIGTERM whatever holds our ports, refusing to touch a process we do not recognise. */
export function stopPortOwners(ports) {
  const stopped = [];
  for (const owner of portOwners(ports)) {
    if (!OURS.test(owner.command)) {
      throw new Error(
        `:${owner.port} is held by pid ${owner.pid} (${owner.command}) — not a FastStudy process, refusing to kill it`,
      );
    }
    try {
      process.kill(owner.pid, 'SIGTERM');
      stopped.push(`${owner.name} (pid ${owner.pid})`);
    } catch {}
  }
  return stopped;
}
