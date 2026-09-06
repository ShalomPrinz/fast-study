import { execFile } from 'node:child_process';
import path from 'node:path';

// curl is not bundled: Windows 10+ ships curl.exe, so it resolves off PATH even in a package.
const SYSTEM_TOOLS = new Set(['curl']);

const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

// ffmpeg and ffprobe print their banner for `--version` but exit 1, having no input file to work
// on; `-version` is the form that exits 0. Everything else takes the GNU spelling.
const VERSION_FLAG = { ffmpeg: '-version', ffprobe: '-version' };

// Long enough for a cold binary on a slow disk, short enough that a few of them cannot delay boot
// past the launcher's health wait.
const VERSION_TIMEOUT_MS = 15000;

// How to spawn an external tool: an absolute path under FASTSTUDY_BIN_DIR when the launcher set
// one, else the bare name for PATH to resolve, which is dev.
export function toolPath(name) {
  const binDir = process.env.FASTSTUDY_BIN_DIR;
  if (!binDir || SYSTEM_TOOLS.has(name)) return name;
  return path.join(binDir, `${name}${EXE_SUFFIX}`);
}

// Spawn one tool's version flag; resolves to 'ok' or a one-line reason it cannot be used.
function checkOne(name) {
  return new Promise((resolve) => {
    execFile(
      toolPath(name),
      [VERSION_FLAG[name] ?? '--version'],
      { timeout: VERSION_TIMEOUT_MS },
      (err) => {
        if (!err) return resolve('ok');
        if (err.code === 'ENOENT') return resolve('missing');
        // execFile reports a timeout as the signal it killed the child with, not as a code.
        if (err.killed) return resolve(`timed out after ${VERSION_TIMEOUT_MS / 1000}s`);
        if (typeof err.code === 'number') return resolve(`exited ${err.code}`);
        resolve(`unusable: ${err.message}`);
      },
    );
  });
}

// Every name mapped to 'ok' or why it is not usable. Never rejects: a missing tool disables one
// feature, so the caller reports it and keeps serving rather than refusing to start.
export async function checkTools(names) {
  const results = await Promise.all(names.map(checkOne));
  return Object.fromEntries(names.map((name, i) => [name, results[i]]));
}
