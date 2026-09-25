// Starting the fakes and the five dev processes, waiting for each to answer, and killing them.
// Every child gets its own process group, recorded in `<harness>/stack.json`, so teardown reaps what
// a service spawned too — the uv/npm parent, a uvicorn worker, vite's esbuild, a running download.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BANNER, HARNESS_ROOT, PORT_NAMES, readPorts } from './env.mjs';

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

/** The pid of a live setup already holding this harness, or null. */
export function liveHolder(paths) {
  const { holder } = readStack(paths);
  if (!holder || holder === process.pid) return null;
  try {
    process.kill(holder, 0);
    return holder;
  } catch {
    return null;
  }
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
    env: { ...spec.env, HARNESS_SERVICE: name },
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
export async function startBrowser(paths, tag) {
  const [port] = await freePorts(1);
  fs.writeFileSync(paths.ports, JSON.stringify({ ...readPorts(paths), [`browser-${tag}`]: port }));
  const script = path.join(HARNESS_ROOT, 'browser.mjs');
  start(`browser-${tag}`, process.execPath, [script, '--port', String(port), '--tag', tag], {
    cwd: HARNESS_ROOT,
    env: { ...process.env, HARNESS_DIR: paths.root, NODE_OPTIONS: '' },
    paths,
    health: `http://127.0.0.1:${port}/health`,
  });
  await waitForService(paths, `browser-${tag}`);
  return port;
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
    `\n# harness: restarted ${new Date().toISOString()}${extra ? ` with${extra}` : ''}\n`,
  );
  spawnSpec(name, { ...spec, env: { ...spec.env, ...overrides } }, paths);
  await waitForService(paths, name);
}

// Listening on all of them at once, so no two come back equal; closed before the caller binds.
async function freePorts(count) {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise((resolve, reject) => {
          const server = net.createServer().once('error', reject);
          server.listen(0, '127.0.0.1', () => resolve(server));
        }),
    ),
  );
  const ports = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer().once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/** This stack's ports: the last run's when every one is still free, so seeded links stay valid, else a fresh set. */
export async function allocatePorts(paths) {
  const previous = readPorts(paths);
  const reuse =
    PORT_NAMES.every((name) => previous[name]) &&
    (await Promise.all(PORT_NAMES.map((name) => isFree(previous[name])))).every(Boolean);
  const fresh = reuse ? [] : await freePorts(PORT_NAMES.length);
  const ports = Object.fromEntries(
    PORT_NAMES.map((name, index) => [name, reuse ? previous[name] : fresh[index]]),
  );
  fs.mkdirSync(paths.root, { recursive: true });
  fs.writeFileSync(paths.ports, JSON.stringify(ports));
  return ports;
}
