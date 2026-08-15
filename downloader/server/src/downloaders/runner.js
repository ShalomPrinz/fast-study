import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  registerDownload,
  deregisterDownload,
  makeStderrTail,
  emitLog,
  emitError,
  formatBytes,
} from '../progress.js';
import { recordDownloadTiming } from '../services/timing.js';
import { setExpectedBytes, startJob, freezeJobBytes, finishJob } from '../jobs.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fast-study-dl-'));
}

function removeTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// Auth signature in a curl (--fail) / yt-dlp stderr tail: an HTTP 401/403 or a
// denied/expired-token phrasing means a replayed token went stale.
function isAuthError(message) {
  if (!message) return false;
  return (
    /\b40[13]\b/.test(message) ||
    /forbidden|unauthorized|access denied/i.test(message) ||
    /(expired|invalid|bad)[ -]?token|token (has )?expired/i.test(message)
  );
}

// Map a failed re-resolve to this job's terminal message: recovery couldn't proceed, so the
// reason has to be user-actionable rather than the raw stderr of the stale attempt.
function reresolveMessage(status, body) {
  if (status === 401) return 'reconnect Moodle';
  if (status === 409) return 'passcode needed';
  if (status === 422) return `source unsupported${body?.message ? `: ${body.message}` : ''}`;
  return `re-capture failed: ${body?.error ?? `HTTP ${status || 'network'}`}`;
}

// Source-agnostic runner: probe size, spawn the silent child in a temp dir, and on clean exit
// hand the result to the source's required `upload` (which uploads + cleans + notifies).
// Adding a source = a new downloaders/*.js registered in index.js; no edits here.
// `jobId` was created synchronously by the route; every exit path must terminate it.
// `reresolve` (null when the caller has no ref, e.g. the extension) refreshes a stale cached
// cap so THIS job re-runs on it — see docs/JOBS.md.
export async function runDownloadJob(
  downloader,
  input,
  { course, lecture, kind, jobId, fromCache = false, reresolve = null },
) {
  const label = `${course}/${lecture}`;
  const tempDir = makeTempDir();
  try {
    // Leading blank line is a TTY-only spacer for the in-place render. Under concurrently
    // stdout is a pipe where each newline gets its own `Downloader |` prefix.
    const spacer = process.stdout.isTTY ? '\n' : '';
    emitLog(`${spacer}📥 ${downloader.tool} downloading to temp: ${tempDir}`);
    const bytes = await downloader.probeSize(input);
    emitLog(`📦 Expected size: ${bytes ? formatBytes(bytes) : 'unknown'}`);
    setExpectedBytes(jobId, bytes);

    const { command, args } = downloader.buildCommand(input, tempDir);
    // stdio ignore/ignore/pipe: child stays silent; stderr captured for error detail.
    const spawnedAt = Date.now();
    const child = spawn(command, args, { cwd: tempDir, stdio: ['ignore', 'ignore', 'pipe'] });
    const tail = makeStderrTail(child);
    const entry = {
      label,
      tempDir,
      measure: downloader.measure,
      expected: bytes,
      tool: downloader.tool,
      lastPercent: null,
      lastEmit: 0,
      emitted: false,
    };
    registerDownload(tempDir, entry);
    startJob(jobId, entry); // the job reads bytes off the same entry the renderer polls

    child.on('error', (err) => {
      deregisterDownload(tempDir);
      emitError(`❌ ${downloader.tool} failed: ${err.message}`);
      finishJob(jobId, 'error', err.message);
      removeTempDir(tempDir);
    });
    child.on('close', async (code) => {
      deregisterDownload(tempDir);
      const finalBytes = freezeJobBytes(jobId); // last measurement before the upload deletes the temp dir
      if (code !== 0) {
        const detail = tail();
        const message = `exited with code ${code}${detail ? `\n${detail}` : ''}`;
        removeTempDir(tempDir);

        // A cached cap's token went stale: re-resolve it fresh and re-run the SAME job. The
        // fresh input is fromCache:false, so a second auth failure can't loop back here.
        if (isAuthError(detail) && fromCache && reresolve) {
          emitError(`♻️  ${downloader.tool} auth failed on a cached token — re-capturing fresh`);
          const fresh = await reresolve();
          if (!fresh.ok) {
            finishJob(jobId, 'error', reresolveMessage(fresh.status, fresh.body));
            return;
          }
          runDownloadJob(fresh.downloader, fresh.input, { course, lecture, kind, jobId });
          return;
        }

        // Non-auth error, a fresh-capture auth failure, or no re-resolve → finalize as-is.
        emitError(`❌ ${downloader.tool} failed: ${message}`);
        finishJob(
          jobId,
          'error',
          isAuthError(detail) ? `authentication failed\n${message}` : message,
        );
        return;
      }
      // Timing sample only after a clean exit — a truncated download is not a valid duration
      recordDownloadTiming(downloader.tool, finalBytes || bytes, (Date.now() - spawnedAt) / 1000);
      // Not done at exit 0 — the bytes are still in a temp dir nobody else can see.
      // The job turns `done` only once the database has them.
      const result = await downloader.upload(tempDir, course, lecture, kind, downloader.tool);
      if (result.ok) finishJob(jobId, 'done');
      else finishJob(jobId, 'error', result.error);
    });
  } catch (err) {
    emitError(`❌ ${downloader.tool} failed: ${err.message}`);
    finishJob(jobId, 'error', err.message);
    removeTempDir(tempDir);
  }
}
