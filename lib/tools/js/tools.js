import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { statePath } from '@faststudy/runtime';

// curl is not bundled: Windows 10+ ships curl.exe, so it resolves off PATH even in a package.
const SYSTEM_TOOLS = new Set(['curl']);

// Tools that update themselves into the writable state root, because the install directory is
// read-only to the running app and an update replaces it wholesale.
const SELF_UPDATING_TOOLS = new Set(['yt-dlp']);

const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

// ffmpeg prints its banner for `--version` but exits 1, having no input file to work on;
// `-version` is the form that exits 0. Everything else takes the GNU spelling.
const VERSION_FLAG = { ffmpeg: '-version' };

// Long enough for a cold binary on a slow disk, short enough that a few of them cannot delay boot
// past the launcher's health wait.
const VERSION_TIMEOUT_MS = 15000;

// Spread into every tool spawn: packaged, the Node services run inside the GUI launcher exe, which
// has no console to share, so a console tool they spawn otherwise opens its own window.
export const NO_WINDOW = { windowsHide: true };

// How to spawn an external tool: an absolute path under FASTSTUDY_BIN_DIR when the launcher set
// one, else the bare name for PATH to resolve, which is dev.
export function toolPath(name) {
  const binDir = process.env.FASTSTUDY_BIN_DIR;
  if (!binDir || SYSTEM_TOOLS.has(name)) return name;
  // Packaged only, so a dev's own PATH copy is never shadowed by a stale state-root one.
  if (SELF_UPDATING_TOOLS.has(name)) {
    const updated = statePath('bin', `${name}${EXE_SUFFIX}`);
    if (existsSync(updated)) return updated;
  }
  return path.join(binDir, `${name}${EXE_SUFFIX}`);
}

// One probe failure: the developer-facing reason plus the named values a render would need.
function failure(state, params) {
  return { state, params };
}

// Spawn one tool's version flag; resolves to 'ok' or a failure record saying why it cannot be used.
function checkOne(name) {
  return new Promise((resolve) => {
    execFile(
      toolPath(name),
      [VERSION_FLAG[name] ?? '--version'],
      { timeout: VERSION_TIMEOUT_MS, ...NO_WINDOW },
      (err) => {
        if (!err) return resolve('ok');
        if (err.code === 'ENOENT') return resolve(failure('missing', { tool: name }));
        // execFile reports a timeout as the signal it killed the child with, not as a code.
        const seconds = VERSION_TIMEOUT_MS / 1000;
        if (err.killed)
          return resolve(failure(`timed out after ${seconds}s`, { tool: name, seconds }));
        if (typeof err.code === 'number')
          // snake_case on the wire, as in the Python half: both spell every param name alike.
          return resolve(failure(`exited ${err.code}`, { tool: name, exit_code: err.code }));
        resolve(failure(`unusable: ${err.message}`, { tool: name, detail: err.message }));
      },
    );
  });
}

// Every name mapped to 'ok' or a {state, params} record saying why it is not usable. Never
// rejects: a missing tool disables one feature, so the caller reports it and keeps serving rather
// than refusing to start. Success stays the bare string, so `!== 'ok'` keeps its meaning.
export async function checkTools(names) {
  const results = await Promise.all(names.map(checkOne));
  return Object.fromEntries(names.map((name, i) => [name, results[i]]));
}
