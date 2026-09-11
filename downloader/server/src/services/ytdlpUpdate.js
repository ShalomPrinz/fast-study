import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { statePath } from '@faststudy/runtime';

const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

// The copy is stale when it is absent or older than the bundled binary: an app release shipping a
// newer yt-dlp must refresh a copy on a machine that can never reach GitHub.
export function needsSeed(bundledMtimeMs, copyMtimeMs) {
  return copyMtimeMs === null || bundledMtimeMs > copyMtimeMs;
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// Copy to a temp name beside the target and rename over it: the rename is atomic, so a crash
// mid-copy cannot leave a truncated exe where the downloaders expect a working one.
function seed(bundled, copy) {
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  const temp = `${copy}.${process.pid}.tmp`;
  fs.copyFileSync(bundled, temp);
  if (process.platform !== 'win32') fs.chmodSync(temp, 0o755);
  fs.renameSync(temp, copy);
}

// Seeds the writable yt-dlp copy from the shipped binary and lets it update itself, in the
// background. Every failure is one stderr line and nothing else: offline and rate-limited GitHub
// are the normal case, and a few minutes on the shipped yt-dlp costs nothing.
export function updateYtdlp() {
  const binDir = process.env.FASTSTUDY_BIN_DIR;
  // Packaged only — a dev run must not seed a copy that would shadow the developer's PATH yt-dlp.
  if (!binDir) return;
  const copy = statePath('bin', `yt-dlp${EXE_SUFFIX}`);
  try {
    const bundled = path.join(binDir, `yt-dlp${EXE_SUFFIX}`);
    const bundledMtime = mtimeMs(bundled);
    if (bundledMtime === null) return;
    if (needsSeed(bundledMtime, mtimeMs(copy))) seed(bundled, copy);
  } catch (err) {
    // stderr, never stdout: stdout is the port-handshake channel the launcher parses.
    console.error(`yt-dlp self-update: cannot seed ${copy} — ${err.message}`);
    return;
  }
  // In the process group (never detached) so the launcher's kill on quit reaches it; yt-dlp writes
  // the new binary beside the old one and renames, so a kill before that leaves the copy working.
  const child = spawn(copy, ['-U'], { stdio: 'ignore' });
  child.on('error', (err) => console.error(`yt-dlp self-update: ${err.message}`));
}
