import fs from 'node:fs';
import path from 'node:path';
import { VIDEO_FILENAME } from './config.js';

// Mirrors popup.js::formatSize (duplicated to keep the two decoupled).
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '?';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

// Children run silent; the server is the SOLE terminal writer, polling temp size
// against the probed total. Full rationale (why not inherit child bars, TTY vs
// pipe-under-concurrently, curl-file vs yt-dlp-dir measure) in docs/PROGRESS.md.
const activeDownloads = new Map();
let renderTimer = null;
let paintedLines = 0; // TTY only: lines in the last repainted block
const RENDER_INTERVAL_MS = 1500;
const NEWLINE_PCT_STEP = 5; // non-TTY: re-print once percent advances this much…
const NEWLINE_MIN_INTERVAL_MS = 8000; // …or this long elapses, whichever first

export function registerDownload(key, entry) {
  activeDownloads.set(key, entry);
  if (!renderTimer) renderTimer = setInterval(renderProgress, RENDER_INTERVAL_MS);
}

export function deregisterDownload(key) {
  clearPainted(); // wipe the live block so the final ✅/❌ line lands clean
  activeDownloads.delete(key);
  if (activeDownloads.size === 0 && renderTimer) {
    clearInterval(renderTimer);
    renderTimer = null;
  }
}

// yt-dlp writes separate audio+video temp files pre-merge, so sum the dir; curl
// writes the lone video.mp4, so stat it.
export function measureBytes(entry) {
  try {
    if (entry.measure === 'dir') {
      let sum = 0;
      for (const name of fs.readdirSync(entry.tempDir)) {
        try {
          sum += fs.statSync(path.join(entry.tempDir, name)).size;
        } catch {}
      }
      return sum;
    }
    return fs.statSync(path.join(entry.tempDir, VIDEO_FILENAME)).size;
  } catch {
    return 0;
  }
}

function progressSnapshot(entry) {
  const got = measureBytes(entry);
  if (!entry.expected) {
    return { pct: null, line: `📥 [${entry.label}] ${formatBytes(got)} downloading…` };
  }
  // Clamp <99% until exit: yt-dlp's merge can transiently overshoot the probed sum.
  const pct = Math.max(0, Math.min(99, Math.floor((got / entry.expected) * 100)));
  return {
    pct,
    line: `📥 [${entry.label}] ${pct}% (${formatBytes(got)}/${formatBytes(entry.expected)})`,
  };
}

function clearPainted() {
  if (process.stdout.isTTY && paintedLines > 0) {
    process.stdout.write(`\x1b[${paintedLines}A\x1b[0J`); // cursor up N, clear to end
    paintedLines = 0;
  }
}

// Route every lifecycle log through these so the TTY block is wiped before a
// permanent line prints (else the next repaint overwrites it).
export function emitLog(line) {
  clearPainted();
  console.log(line);
}
export function emitError(line) {
  clearPainted();
  console.error(line);
}

function renderProgress() {
  const entries = [...activeDownloads.values()];
  if (entries.length === 0) return;
  if (process.stdout.isTTY) {
    // npm start: repaint a compact block in place via ANSI.
    let out = paintedLines > 0 ? `\x1b[${paintedLines}A` : '';
    for (const e of entries) out += `\x1b[2K${progressSnapshot(e).line}\n`;
    process.stdout.write(out);
    paintedLines = entries.length;
    return;
  }
  // Under `concurrently` stdout is a pipe (lines prefixed `Downloader |`), so ANSI
  // repaint is meaningless; emit throttled whole lines that can't interleave mid-line.
  const now = Date.now();
  for (const e of entries) {
    const { pct, line } = progressSnapshot(e);
    const advanced =
      pct != null && e.lastPercent != null && pct - e.lastPercent >= NEWLINE_PCT_STEP;
    if (!e.emitted || advanced || now - e.lastEmit >= NEWLINE_MIN_INTERVAL_MS) {
      console.log(line);
      e.emitted = true;
      if (pct != null) e.lastPercent = pct;
      e.lastEmit = now;
    }
  }
}

// Keep the last few KB of a child's stderr so a non-zero exit can log the real
// error — we no longer inherit stderr, so this tail is our only error surface.
export function makeStderrTail(child, maxLines = 15) {
  let buf = '';
  child.stderr?.on('data', (c) => {
    buf += c;
    if (buf.length > 65536) buf = buf.slice(-65536);
  });
  return () =>
    buf
      .split('\n')
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .slice(-maxLines)
      .join('\n');
}
