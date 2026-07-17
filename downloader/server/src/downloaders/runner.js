import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  registerDownload, deregisterDownload, makeStderrTail, emitLog, emitError, formatBytes,
} from '../progress.js';
import { uploadVideo } from '../services/database.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fast-study-dl-'));
}

function removeTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Source-agnostic runner: probe size, spawn the silent child in a temp dir, and on
// clean exit hand the video to the database (which uploads + cleans + notifies).
// Adding a source = a new downloaders/*.js registered in index.js; no edits here.
export async function runDownloadJob(downloader, input, { course, lecture, kind }) {
  const label = `${course}/${lecture}`;
  const tempDir = makeTempDir();
  emitLog(`\n📥 ${downloader.tool} downloading to temp: ${tempDir}`);
  const bytes = await downloader.probeSize(input);
  emitLog(`📦 Expected size: ${bytes ? formatBytes(bytes) : 'unknown'}`);

  const { command, args } = downloader.buildCommand(input, tempDir);
  // stdio ignore/ignore/pipe: child stays silent; stderr captured for error detail.
  const child = spawn(command, args, { cwd: tempDir, stdio: ['ignore', 'ignore', 'pipe'] });
  const tail = makeStderrTail(child);
  registerDownload(tempDir, {
    label, tempDir, measure: downloader.measure, expected: bytes,
    tool: downloader.tool, lastPercent: null, lastEmit: 0, emitted: false,
  });

  child.on('error', (err) => {
    deregisterDownload(tempDir);
    emitError(`❌ ${downloader.tool} failed: ${err.message}`);
    removeTempDir(tempDir);
  });
  child.on('close', (code) => {
    deregisterDownload(tempDir);
    if (code === 0) {
      uploadVideo(tempDir, course, lecture, kind, downloader.tool);
    } else {
      const detail = tail();
      emitError(`❌ ${downloader.tool} failed: exited with code ${code}${detail ? `\n${detail}` : ''}`);
      removeTempDir(tempDir);
    }
  });
}
