// Starting the fakes and the five dev processes, waiting for each to answer, and killing them.
// Every child gets its own process group, recorded in `<harness>/stack.json`, so teardown reaps what
// a service spawned too — the uv/npm parent, a uvicorn worker, vite's esbuild, a running download.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BANNER, HARNESS_ROOT, readPorts } from './env.mjs';

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

// The child learns the port it should bind from `FASTSTUDY_PORT` and reports the one it bound as
// `FASTSTUDY_PORT=<n>` alone on a line — the packaged launcher's handshake, so nothing races for it.
const PORT_LINE = '^FASTSTUDY_PORT=(\\d+)$';

const REPORT_TIMEOUT_MS = 120_000;

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
  return child;
}

/** Spawn a recorded spec and read every port its `reports` patterns name off its log, or fail naming the service. */
async function spawnReporting(name, spec, paths) {
  const log = logOf(paths, name);
  const from = fs.statSync(log).size;
  const child = spawnSpec(name, spec, paths);
  let exited = null;
  child.once('exit', (code, signal) => (exited = signal ?? `code ${code}`));
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  for (;;) {
    const text = fs.readFileSync(log, 'utf8').slice(from);
    const found = Object.entries(spec.reports).map(([key, source]) => [
      key,
      new RegExp(source, 'm').exec(text)?.[1],
    ]);
    if (found.every(([, port]) => port)) {
      const ports = Object.fromEntries(found.map(([key, port]) => [key, Number(port)]));
      const stack = readStack(paths);
      stack.services[name] = {
        ...stack.services[name],
        env: { ...spec.env, ...Object.fromEntries(found) },
        health: `http://127.0.0.1:${ports.FASTSTUDY_PORT}${spec.healthPath}`,
      };
      writeStack(paths, stack);
      return ports;
    }
    if (exited || Date.now() > deadline) {
      await killGroup(child.pid);
      const why = exited ? `exited (${exited})` : `timed out after ${REPORT_TIMEOUT_MS / 1000}s`;
      const tail = text.split('\n').slice(-25).join('\n');
      throw new Error(`${name} ${why} before reporting its port\n--- ${log} ---\n${tail}`);
    }
    await sleep(100);
  }
}

/** Spawn one service in its own process group, logged to `<logs>/<name>.log`, and return its reported ports by env var.
 *  `want` is each env var's port to try first, falling back to 0 when unset or not bindable. */
export async function start(
  name,
  command,
  args,
  { cwd, env, paths, want = {}, reports = { FASTSTUDY_PORT: PORT_LINE }, healthPath = '/health' },
) {
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.writeFileSync(logOf(paths, name), `# ${BANNER}\n# ${command} ${args.join(' ')}\n`);
  const spec = (ports) => ({ command, args, cwd, env: { ...env, ...ports }, reports, healthPath });
  const asked = Object.fromEntries(
    Object.keys(reports).map((key) => [key, String(want[key] ?? 0)]),
  );
  try {
    return await spawnReporting(name, spec(asked), paths);
  } catch (error) {
    if (Object.values(asked).every((port) => port === '0')) throw error;
    const any = Object.fromEntries(Object.keys(reports).map((key) => [key, '0']));
    fs.appendFileSync(logOf(paths, name), `\n# harness: retrying on any free port\n`);
    return spawnReporting(name, spec(any), paths);
  }
}

/** Start a browser.mjs session, recorded as `browser-<tag>` so --down reaps it, and wait for it. */
export async function startBrowser(paths, tag) {
  const name = `browser-${tag}`;
  const script = path.join(HARNESS_ROOT, 'browser.mjs');
  const { FASTSTUDY_PORT: port } = await start(name, process.execPath, [script, '--tag', tag], {
    cwd: HARNESS_ROOT,
    env: { ...process.env, HARNESS_DIR: paths.root, NODE_OPTIONS: '' },
    paths,
    want: { FASTSTUDY_PORT: readPorts(paths)[name] },
  });
  fs.writeFileSync(paths.ports, JSON.stringify({ ...readPorts(paths), [name]: port }));
  await waitForService(paths, name);
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

function recordedSpec(paths, name) {
  const { services } = readStack(paths);
  const spec = services[name];
  if (!spec) {
    const known = Object.keys(services).join(', ') || 'none';
    throw new Error(`no service "${name}" recorded under ${paths.root} (recorded: ${known})`);
  }
  return spec;
}

/** Kill one recorded service's whole group and leave it down; `restart` brings it back. */
export async function kill(paths, name) {
  await killGroup(recordedSpec(paths, name).pid);
  fs.appendFileSync(logOf(paths, name), `\n# harness: killed ${new Date().toISOString()}\n`);
}

/** Kill one recorded service and start it again from its exact spec, ports included, `overrides` on top of its env. */
export async function restart(paths, name, overrides) {
  const spec = recordedSpec(paths, name);
  await killGroup(spec.pid);
  const extra = Object.entries(overrides)
    .map(([key, item]) => ` ${key}=${item}`)
    .join('');
  fs.appendFileSync(
    logOf(paths, name),
    `\n# harness: restarted ${new Date().toISOString()}${extra ? ` with${extra}` : ''}\n`,
  );
  // No fallback to a free port: every peer and the SPA were started pointing at the recorded one.
  await spawnReporting(name, { ...spec, env: { ...spec.env, ...overrides } }, paths);
  await waitForService(paths, name);
}
