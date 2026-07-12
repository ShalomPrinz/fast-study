import http from 'node:http';
import https from 'node:https';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

loadEnv(path.join(REPO_ROOT, '.env'));
const DATABASE_URL = process.env.DATABASE_URL ?? 'http://localhost:8001';

const PORT = 3052;
const EXTENSION_ID = 'kebkiehjoihdofnobkbifjcihnifibdo';
const VIDEO_FILENAME = 'video.mp4';
const MATERIAL_FILENAME = 'material.pdf';

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', `chrome-extension://${EXTENSION_ID}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// database `/tree` returns lectures/recitations as rich objects
// ({name, files, transcribePartial}); popup.js only wants the names.
// Before: course.lectures = [{name, files, ...}, ...]  -> autocomplete shows "[object Object]"
// After:  course.lectures = ["Lecture 1", ...]         -> autocomplete works
async function listCourses() {
  const res = await fetch(`${DATABASE_URL}/tree`);
  if (!res.ok) throw new Error(`database /tree returned ${res.status}`);
  const tree = await res.json();
  return tree
    .filter((c) => !c.archived) // Archived courses are dropped
    .map((c) => ({
      name: c.name,
      lectures: (c.lectures ?? []).map((l) => l.name),
      recitations: (c.recitations ?? []).map((r) => r.name),
    }));
}

function isSafeName(name) {
  return typeof name === 'string'
    && name.length > 0
    && !name.includes('/')
    && !name.includes('\\')
    && name !== '.'
    && name !== '..';
}

// Range/conditional headers cause curl to fetch a partial body — the file
// then lacks the MP4 header at offset 0 and is unplayable.
const SKIP_HEADERS = new Set([
  'range', 'if-range', 'if-none-match', 'if-modified-since',
  'host', 'content-length',
]);

// Mirrors popup.js::formatSize — duplicated locally to keep server.js
// dependency-free and decoupled from the extension code.
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '?';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

// ── Active-download progress ────────────────────────────────────────────────
// failure: curl's --progress-bar / yt-dlp's --progress write \r-repainted lines;
// two parallel downloads share one terminal line and stomp each other (and our
// console.logs) -> overwrite + flicker.
// Before: each child writes its own \r bar to the inherited terminal.
// After:  children run silent; the server is the SOLE terminal writer — it polls
//         each temp file's size against the probed total and emits whole lines.
const activeDownloads = new Map();
let renderTimer = null;
let paintedLines = 0; // TTY only: number of lines in the last repainted block
const RENDER_INTERVAL_MS = 1500;
const NEWLINE_PCT_STEP = 5;           // non-TTY: re-print once percent advances this much…
const NEWLINE_MIN_INTERVAL_MS = 8000; // …or this long elapses, whichever comes first

function registerDownload(key, entry) {
  activeDownloads.set(key, entry);
  // Only run the timer while something is in flight — don't leave it idling.
  if (!renderTimer) renderTimer = setInterval(renderProgress, RENDER_INTERVAL_MS);
}

function deregisterDownload(key) {
  clearPainted(); // wipe the live block so the final ✅/❌ line lands clean
  activeDownloads.delete(key);
  if (activeDownloads.size === 0 && renderTimer) {
    clearInterval(renderTimer);
    renderTimer = null;
  }
}

// failure: yt-dlp writes separate audio+video temp files and merges them, so the
// single output file doesn't exist yet mid-download.
// Before: stat video.mp4 -> 0 bytes for most of a yt-dlp run.
// After:  sum every file in the temp dir for yt-dlp; stat the lone video.mp4 for curl.
function measureBytes(entry) {
  try {
    if (entry.measure === 'dir') {
      let sum = 0;
      for (const name of fs.readdirSync(entry.tempDir)) {
        try { sum += fs.statSync(path.join(entry.tempDir, name)).size; } catch {}
      }
      return sum;
    }
    return fs.statSync(path.join(entry.tempDir, VIDEO_FILENAME)).size;
  } catch { return 0; }
}

function progressSnapshot(entry) {
  const got = measureBytes(entry);
  if (!entry.expected) {
    // Unknown probe -> a byte count is the most we can honestly show.
    return { pct: null, line: `📥 [${entry.label}] ${formatBytes(got)} downloading…` };
  }
  // Clamp <99% until exit: yt-dlp's merge can transiently overshoot the probed sum.
  const pct = Math.max(0, Math.min(99, Math.floor((got / entry.expected) * 100)));
  return { pct, line: `📥 [${entry.label}] ${pct}% (${formatBytes(got)}/${formatBytes(entry.expected)})` };
}

function clearPainted() {
  if (process.stdout.isTTY && paintedLines > 0) {
    process.stdout.write(`\x1b[${paintedLines}A\x1b[0J`); // cursor up N lines, clear to end of screen
    paintedLines = 0;
  }
}

// Route every download-lifecycle log through these so the TTY progress block is
// wiped before a permanent line prints (otherwise the next repaint overwrites it).
function emitLog(line) { clearPainted(); console.log(line); }
function emitError(line) { clearPainted(); console.error(line); }

function renderProgress() {
  const entries = [...activeDownloads.values()];
  if (entries.length === 0) return;
  if (process.stdout.isTTY) {
    // Real terminal (npm start): repaint a compact block in place via ANSI.
    let out = paintedLines > 0 ? `\x1b[${paintedLines}A` : '';
    for (const e of entries) out += `\x1b[2K${progressSnapshot(e).line}\n`; // clear line + content
    process.stdout.write(out);
    paintedLines = entries.length;
    return;
  }
  // failure: under `concurrently` (npm run dev) stdout is a PIPE, not a TTY, and
  // every line is prefixed `Downloader |` — ANSI cursor repaint is meaningless.
  // Before: \x1b cursor codes -> garbage in the aggregated log.
  // After:  emit a throttled newline-terminated line; whole-line console.logs
  //         from sibling processes can't interleave mid-line -> flicker-free.
  const now = Date.now();
  for (const e of entries) {
    const { pct, line } = progressSnapshot(e);
    const advanced = pct != null && e.lastPercent != null && pct - e.lastPercent >= NEWLINE_PCT_STEP;
    if (!e.emitted || advanced || now - e.lastEmit >= NEWLINE_MIN_INTERVAL_MS) {
      console.log(line);
      e.emitted = true;
      if (pct != null) e.lastPercent = pct;
      e.lastEmit = now;
    }
  }
}

// Keep the last few KB of a child's stderr so a non-zero exit can still log the
// real error — we no longer inherit stderr, so this tail is our only error surface.
function makeStderrTail(child, maxLines = 15) {
  let buf = '';
  child.stderr?.on('data', (c) => {
    buf += c;
    if (buf.length > 65536) buf = buf.slice(-65536);
  });
  return () => buf.split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-maxLines).join('\n');
}

function headersToObject(headers) {
  const out = {};
  for (const h of headers ?? []) {
    if (SKIP_HEADERS.has(h.name.toLowerCase())) continue;
    out[h.name] = h.value;
  }
  return out;
}

function requestHead(url, headers, method, extraHeaders) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      url,
      { method, headers: { ...headersToObject(headers), ...(extraHeaders ?? {}) } },
      (res) => {
        res.resume(); // drain
        resolve(res);
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// HEAD often works on signed video URLs (token is in the query string).
// Before: HEAD blocked by CDN -> no size shown.
// After:  fall back to a single-byte ranged GET and read Content-Range's total.
async function probeContentLength(url, headers) {
  const head = await requestHead(url, headers, 'HEAD');
  if (head) {
    const len = head.headers['content-length'];
    if (head.statusCode && head.statusCode < 400 && len) return +len;
  }
  const ranged = await requestHead(url, headers, 'GET', { Range: 'bytes=0-0' });
  if (ranged) {
    const cr = ranged.headers['content-range'];
    const m = cr && cr.match(/\/(\d+)\s*$/);
    if (m) return +m[1];
  }
  return null;
}

function buildCurlArgs(url, headers) {
  // Video CDNs sometimes close TLS without close_notify mid-stream; OpenSSL 3
  // surfaces this as `SSL_read: unexpected eof`. Retry on any error so a flaky
  // connection doesn't abort the whole download.
  // --silent --show-error: no live progress bar (the server polls size itself),
  // but a failed transfer still writes its reason to stderr for the tail buffer.
  const args = [
    '-L', '--fail', '--compressed', '--silent', '--show-error',
    '--retry', '3', '--retry-delay', '2', '--retry-all-errors',
    '--output', VIDEO_FILENAME,
  ];
  for (const h of headers ?? []) {
    if (SKIP_HEADERS.has(h.name.toLowerCase())) continue;
    args.push('-H', `${h.name}: ${h.value}`);
  }
  args.push(url);
  return args;
}

// Stream the just-downloaded video.mp4 from a temp dir to the database
// service. Cleans up the temp dir whether the upload succeeded or not.
// On failure (network, {ok:false}, or non-2xx), logs and skips notifyFrontend
// — same surface as today's curl/mkdir failures.
async function uploadAndCleanup(tempDir, course, lecture, kind, label) {
  const file = path.join(tempDir, VIDEO_FILENAME);
  try {
    const url = `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/video?kind=${encodeURIComponent(kind)}`;
    const stream = fs.createReadStream(file);
    // duplex: 'half' is required when fetch body is a stream (undici).
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Readable.toWeb(stream),
      duplex: 'half',
    });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok || body?.ok === false) {
      const msg = body?.error ?? `HTTP ${res.status}`;
      emitError(`❌ ${label} upload to database failed: ${msg}`);
      return;
    }
    emitLog(`✅ Uploaded ${VIDEO_FILENAME} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
  } catch (err) {
    emitError(`❌ ${label} upload to database failed: ${err.message}`);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function runDownload(url, headers, tempDir, course, lecture, kind) {
  const label = `${course}/${lecture}`;
  emitLog(`\n📥 Downloading to temp: ${tempDir}`);
  const bytes = await probeContentLength(url, headers);
  emitLog(`📦 Expected size: ${bytes ? formatBytes(bytes) : 'unknown'}`);
  // stdio ignore/ignore/pipe: curl stays silent (server polls video.mp4's size
  // and renders progress); stderr is captured so a failed exit still has detail.
  const child = spawn('curl', buildCurlArgs(url, headers), { cwd: tempDir, stdio: ['ignore', 'ignore', 'pipe'] });
  const tail = makeStderrTail(child);
  registerDownload(tempDir, { label, tempDir, measure: 'file', expected: bytes, tool: 'curl', lastPercent: null, lastEmit: 0, emitted: false });
  child.on('error', (err) => {
    deregisterDownload(tempDir);
    emitError(`❌ Download failed: ${err.message}`);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });
  child.on('close', (code) => {
    deregisterDownload(tempDir);
    if (code === 0) {
      uploadAndCleanup(tempDir, course, lecture, kind, 'curl');
    } else {
      const detail = tail();
      emitError(`❌ Download failed: curl exited with code ${code}${detail ? `\n${detail}` : ''}`);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
}

// Non-blocking ping to the database service so subscribed sidebars refetch the tree.
// Failure is silent: if the frontend isn't running the download must still succeed.
function notifyFrontend() {
  try {
    const req = http.request(
      `${DATABASE_URL}/notify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } },
    );
    req.on('error', () => {});
    req.end('{}');
  } catch {}
}

// Probe the merged-mp4 size by asking yt-dlp to print filesize fields without
// downloading. `bv*+ba/b` matches the same format selection the real download
// uses, so the printed sizes sum to the final mp4's approximate byte count.
function probeYoutubeSize(url) {
  return new Promise((resolve) => {
    execFile(
      'yt-dlp',
      [
        '--no-playlist', '--no-warnings', '--quiet',
        '--skip-download',
        '-f', 'bv*+ba/b',
        '--print', '%(filesize,filesize_approx)s',
        url,
      ],
      { timeout: 20000 },
      (err, stdout) => {
        if (err) return resolve(null);
        let total = 0;
        for (const line of (stdout ?? '').split('\n')) {
          const n = parseInt(line.trim(), 10);
          if (Number.isFinite(n)) total += n;
        }
        resolve(total > 0 ? total : null);
      },
    );
  });
}

async function runYoutubeDownload(url, tempDir, course, lecture, kind) {
  const label = `${course}/${lecture}`;
  emitLog(`\n📥 yt-dlp downloading to temp: ${tempDir}`);
  const bytes = await probeYoutubeSize(url);
  emitLog(`📦 Expected size: ${bytes ? formatBytes(bytes) : 'unknown'}`);
  // -o video.%(ext)s + --merge-output-format mp4 -> final file is `video.mp4`.
  // --no-playlist keeps a playlist-context URL to the single current video.
  // Recent yt-dlp needs a JS runtime to evaluate YouTube's player script;
  // only `deno` is auto-enabled, so point it at the `node` we already have.
  // `--quiet --no-warnings --no-progress`: silent run; the server polls the temp
  // dir's total size and renders progress, so no live bar fights other downloads.
  const args = [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--quiet', '--no-warnings', '--no-progress',
    '-o', 'video.%(ext)s',
    url,
  ];
  // stdio ignore/ignore/pipe: capture stderr for error reporting (see makeStderrTail).
  const child = spawn('yt-dlp', args, { cwd: tempDir, stdio: ['ignore', 'ignore', 'pipe'] });
  const tail = makeStderrTail(child);
  registerDownload(tempDir, { label, tempDir, measure: 'dir', expected: bytes, tool: 'yt-dlp', lastPercent: null, lastEmit: 0, emitted: false });
  child.on('error', (err) => {
    deregisterDownload(tempDir);
    emitError(`❌ yt-dlp failed: ${err.message}`);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });
  child.on('close', (code) => {
    deregisterDownload(tempDir);
    if (code === 0) {
      uploadAndCleanup(tempDir, course, lecture, kind, 'yt-dlp');
    } else {
      const detail = tail();
      emitError(`❌ yt-dlp failed: exited with code ${code}${detail ? `\n${detail}` : ''}`);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fast-study-dl-'));
}

const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$|^youtu\.be$/i;

async function handleDownloadYoutube(req, res) {
  const { url, course, lecture, kind = 'lecture' } = JSON.parse(await readBody(req));

  let host = '';
  try { host = new URL(url).hostname; } catch {}
  if (!host || !YOUTUBE_HOST_RE.test(host)) {
    return send(res, 400, { error: 'valid youtube url required' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return send(res, 400, { error: 'course and lecture are required' });
  }
  if (kind !== 'lecture' && kind !== 'recitation') {
    return send(res, 400, { error: `invalid kind: ${kind}` });
  }

  const tempDir = makeTempDir();
  runYoutubeDownload(url, tempDir, course, lecture, kind);
  send(res, 200, { status: 'Downloading in background...', target: `${course}/${lecture}` });
}

async function handleDownload(req, res) {
  const { url, headers, course, lecture, kind = 'lecture' } = JSON.parse(await readBody(req));

  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return send(res, 400, { error: 'valid url required' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return send(res, 400, { error: 'course and lecture are required' });
  }
  if (kind !== 'lecture' && kind !== 'recitation') {
    return send(res, 400, { error: `invalid kind: ${kind}` });
  }

  const tempDir = makeTempDir();
  // Fire-and-forget so a slow size probe doesn't delay the HTTP response.
  runDownload(url, headers, tempDir, course, lecture, kind);
  send(res, 200, { status: 'Downloading in background...', target: `${course}/${lecture}` });
}

// The popup downloads the PDF itself (so the user's browser session cookies
// authenticate the fetch) and streams the bytes here; we forward them to the
// database's neutral `/files/material.pdf` endpoint (no derived-artifact wipe).
async function handleUploadPdf(req, res) {
  const u = new URL(req.url, 'http://x');
  const course = u.searchParams.get('course') ?? '';
  const lecture = u.searchParams.get('lecture') ?? '';
  const kind = u.searchParams.get('kind') ?? 'lecture';

  if (!isSafeName(course) || !isSafeName(lecture)) {
    return send(res, 400, { error: 'course and lecture are required' });
  }
  if (kind !== 'lecture' && kind !== 'recitation') {
    return send(res, 400, { error: `invalid kind: ${kind}` });
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  emitLog(`\n📥 PDF upload received: ${formatBytes(buf.length)} for ${course}/${lecture} (kind=${kind})`);
  if (buf.length === 0) {
    return send(res, 400, { error: 'empty body' });
  }

  const dbUrl = `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/files/${MATERIAL_FILENAME}?kind=${encodeURIComponent(kind)}`;
  try {
    const dbRes = await fetch(dbUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: buf,
    });
    let body = null;
    try { body = await dbRes.json(); } catch {}
    if (!dbRes.ok || body?.ok === false) {
      const msg = body?.error ?? `HTTP ${dbRes.status}`;
      emitError(`❌ PDF upload to database failed: ${msg}`);
      return send(res, 502, { error: msg });
    }
    emitLog(`✅ Uploaded ${MATERIAL_FILENAME} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
    send(res, 200, { status: 'PDF uploaded', target: `${course}/${lecture}` });
  } catch (err) {
    emitError(`❌ PDF upload to database failed: ${err.message}`);
    send(res, 500, { error: err.message });
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (req.method === 'GET' && req.url === '/courses') {
      return send(res, 200, await listCourses());
    }
    if (req.method === 'POST' && req.url === '/probe-size') {
      const { url, headers } = JSON.parse(await readBody(req));
      const bytes = await probeContentLength(url, headers);
      return send(res, 200, { bytes });
    }
    if (req.method === 'POST' && req.url === '/download') {
      return await handleDownload(req, res);
    }
    if (req.method === 'POST' && req.url === '/download-youtube') {
      return await handleDownloadYoutube(req, res);
    }
    if (req.method === 'POST' && req.url?.startsWith('/upload-pdf')) {
      return await handleUploadPdf(req, res);
    }
    res.writeHead(404).end();
  } catch (e) {
    emitError(e?.stack ?? String(e));
    send(res, 500, { error: e.message ?? 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🎧 Downloader listening on port ${PORT}`);
  console.log(`📁 DATABASE_URL: ${DATABASE_URL}`);
  console.log(`==========================================\n`);
});
