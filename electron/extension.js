const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

// The extension pins this ID with the `key` in its manifest (downloader/extension/CLAUDE.md).
const EXTENSION_ID = 'hknnjgdhokbapjodjklfodhobjekjlnn';
const HOST_NAME = 'com.faststudy.bridge';
const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
// Rewritten to a variable reference in the generated .bat, so a non-ASCII user name never has to
// survive cmd's codepage — env values expand as UTF-16 inside cmd, file bytes do not.
const PREFIX_VARS = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE'];

/** The `version` in `<dir>/manifest.json`, or null when there is no readable manifest. */
function manifestVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** One path as a quoted .bat argument: its longest env-var prefix as `%VAR%`, the rest with `%`
 *  doubled so cmd does not expand it. */
function batchPath(target, env) {
  let prefix = '';
  let variable = null;
  for (const name of PREFIX_VARS) {
    const value = env[name]?.replace(/[\\/]+$/, '');
    if (!value || value.length <= prefix.length) continue;
    const head = target.slice(0, value.length);
    const boundary = target[value.length];
    if (head.toLowerCase() === value.toLowerCase() && (boundary === '\\' || boundary === '/')) {
      prefix = value;
      variable = name;
    }
  }
  const rest = target.slice(prefix.length).replaceAll('%', '%%');
  return `"${variable ? `%${variable}%` : ''}${rest}"`;
}

/** The host .bat Chrome runs: FastStudy.exe as node on the host script, handed the bridge file.
 *  `@echo off` first, since anything cmd echoes would corrupt the framed stdout. */
function hostBatch({ exe, script, bridgeFile, env }) {
  const command = [exe, script, bridgeFile].map((part) => batchPath(part, env)).join(' ');
  return ['@echo off', 'setlocal', 'set ELECTRON_RUN_AS_NODE=1', command, ''].join('\r\n');
}

/** Write only on a change: cmd reads a running .bat line by line, so rewriting it under a live
 *  host could break that run. */
function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return;
  } catch {
    // Missing: write it.
  }
  fs.writeFileSync(file, content);
}

/** Register the native host for this launch: the .bat and host manifest under `<state>/native-host`,
 *  then the HKCU key Chrome looks it up by. Idempotent; every failure is logged, never thrown. */
function registerHost({
  stateDir,
  exe,
  script,
  bridgeFile,
  log,
  env = process.env,
  run = execFile,
}) {
  const dir = path.join(stateDir, 'native-host');
  const batch = path.join(dir, 'host.bat');
  const manifest = path.join(dir, `${HOST_NAME}.json`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeIfChanged(batch, hostBatch({ exe, script, bridgeFile, env }));
    const host = {
      name: HOST_NAME,
      description: 'FastStudy: the running app’s download server port and launch secret',
      path: batch,
      type: 'stdio',
      // The trailing slash is required; Chrome matches the origin string exactly.
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    };
    writeIfChanged(manifest, `${JSON.stringify(host, null, 2)}\n`);
  } catch (error) {
    log('main', `native host not registered: ${error.message}`);
    return;
  }
  run(
    'reg',
    ['add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'],
    { windowsHide: true },
    (error) =>
      log(
        'main',
        error
          ? `native host registry write failed: ${error.message}`
          : `native host registered: ${manifest}`,
      ),
  );
}

/** Write the bridge file whole — tmp then rename, so the host never reads half of it. It holds the
 *  launch secret: its contents are never logged. */
function writeBridge(file, bridge) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bridge), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Remove the bridge file, so the host answers `{ running: false }`. Synchronous, for `exit`. */
function removeBridge(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // A locked file outlives this launch; the next one overwrites it once `server` is up.
  }
}

/** Refresh the folder Chrome loads the extension from when its version differs from the shipped one,
 *  replacing it whole. The path never moves, which a load-unpacked extension needs. */
function syncExtension(source, target) {
  const shipped = manifestVersion(source);
  if (!shipped) throw new Error(`no shipped extension manifest in ${source}`);
  const current = manifestVersion(target);
  if (current === shipped) return `extension ${shipped} current`;
  const fresh = `${target}.new`;
  const old = `${target}.old`;
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.rmSync(old, { recursive: true, force: true });
  fs.cpSync(source, fresh, { recursive: true });
  // Renamed away rather than deleted in place: a locked file fails the rename cleanly, where a
  // recursive delete would stop halfway and leave Chrome a broken folder.
  if (fs.existsSync(target)) fs.renameSync(target, old);
  fs.renameSync(fresh, target);
  const copied = `extension ${current ?? 'missing'} → ${shipped} copied to ${target}`;
  try {
    fs.rmSync(old, { recursive: true, force: true });
  } catch (error) {
    // The swap is done; only the old copy is left over, and the next copy clears it.
    return `${copied}; old copy left at ${old}: ${error.message}`;
  }
  return copied;
}

module.exports = {
  REG_KEY,
  batchPath,
  hostBatch,
  manifestVersion,
  registerHost,
  removeBridge,
  syncExtension,
  writeBridge,
};
