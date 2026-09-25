// Starting the fakes and the five dev processes, waiting for each to answer, and killing them.
// Every child gets its own process group, recorded in `<harness>/stack.json`, so teardown reaps what
// a service spawned too — the uv/npm parent, a uvicorn worker, vite's esbuild, a running download.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BANNER, HUNT_ROOT } from './env.mjs';

const stackFile = (paths) => path.join(paths.root, 'stack.json');

/** The recorded stack: `{ holder, services: { name: { pid, command, args, cwd, env, health } } }`. */
export function readStack(paths) {
  try {
    return JSON.parse(fs.readFileSync(stackFile(paths), 'utf8'));
  } catch {
    return { services: {} };
  }
}

// 0600: the recorded env is the caller's whole environment, not only the harness's fake keys.
function writeStack(paths, stack) {
  fs.writeFileSync(stackFile(paths), JSON.stringify(stack, null, 2), { mode: 0o600 });
}

/** Begin a fresh record held by this setup process, dropping whatever a dead run left. */
export function resetStack(paths) {
  writeStack(paths, { holder: process.pid, services: {} });
}

/** The log file a service writes to. */
export function logOf(paths, name) {
  return path.join(paths.logs, `${name}.log`);
}

function spawnSpec(name, spec, paths) {
  const handle = fs.openSync(logOf(paths, name), 'a');
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...spec.env, HUNT_BUGS_SERVICE: name },
    stdio: ['ignore', handle, handle],
    detached: true,
  });
  fs.closeSync(handle);
  child.unref();
  const stack = readStack(paths);
  stack.services[name] = { ...spec, pid: child.pid };
  writeStack(paths, stack);
}

/** Spawn one service in its own process group, logged to `<logs>/<name>.log`, and record it. */
export function start(name, command, args, { cwd, env, paths, health }) {
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.writeFileSync(logOf(paths, name), `# ${BANNER}\n# ${command} ${args.join(' ')}\n`);
  spawnSpec(name, { command, args, cwd, env, health }, paths);
}

/** Start a browser.mjs session, recorded as `browser-<tag>` so --down reaps it, and wait for it. */
export async function startBrowser(paths, tag, port) {
  const script = path.join(HUNT_ROOT, 'browser.mjs');
  start(`browser-${tag}`, process.execPath, [script, '--port', String(port), '--tag', tag], {
    cwd: HUNT_ROOT,
    env: { ...process.env, HUNT_BUGS_HARNESS: paths.root, NODE_OPTIONS: '' },
    paths,
    health: `http://127.0.0.1:${port}/health`,
  });
  await waitForService(paths, `browser-${tag}`);
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

/** Wait until a recorded service answers its health URL. */
export function waitForService(paths, name) {
  const { health } = readStack(paths).services[name];
  return waitFor(name, health, { logFile: logOf(paths, name) });
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

// The whole group, so the uv/npm parent dies with the child it wraps; SIGKILL whatever outlives 10s.
async function killGroup(pgid) {
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + 10_000;
  while (groupAlive(pgid) && Date.now() < deadline) await sleep(200);
  if (!groupAlive(pgid)) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {}
  while (groupAlive(pgid)) await sleep(100);
}

/** Kill every recorded process group, drop the record, and release a setup still holding it. */
export async function down(paths) {
  const { holder, services } = readStack(paths);
  await Promise.all(Object.values(services).map((spec) => killGroup(spec.pid)));
  fs.rmSync(stackFile(paths), { force: true });
  if (holder && holder !== process.pid) {
    try {
      process.kill(holder, 'SIGTERM');
    } catch {}
  }
  return Object.keys(services);
}

/** Kill one recorded service and start it again from its exact spec, `overrides` on top of its env. */
export async function restart(paths, name, overrides) {
  const { services } = readStack(paths);
  const spec = services[name];
  if (!spec) {
    const known = Object.keys(services).join(', ') || 'none';
    throw new Error(`no service "${name}" recorded under ${paths.root} (recorded: ${known})`);
  }
  await killGroup(spec.pid);
  const extra = Object.entries(overrides)
    .map(([key, item]) => ` ${key}=${item}`)
    .join('');
  fs.appendFileSync(
    logOf(paths, name),
    `\n# hunt-bugs: restarted ${new Date().toISOString()}${extra ? ` with${extra}` : ''}\n`,
  );
  spawnSpec(name, { ...spec, env: { ...spec.env, ...overrides } }, paths);
  await waitForService(paths, name);
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
