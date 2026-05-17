import http from 'node:http';
import https from 'node:https';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

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
  return tree.map((c) => ({
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
  const args = [
    '-L', '--fail', '--compressed', '--progress-bar', '--show-error',
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
      console.error(`❌ ${label} upload to database failed: ${msg}`);
      return;
    }
    console.log(`✅ Uploaded ${VIDEO_FILENAME} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
  } catch (err) {
    console.error(`❌ ${label} upload to database failed: ${err.message}`);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function runDownload(url, headers, tempDir, course, lecture, kind) {
  console.log(`\n📥 Downloading to temp: ${tempDir}`);
  const bytes = await probeContentLength(url, headers);
  console.log(`📦 Expected size: ${bytes ? formatBytes(bytes) : 'unknown'}`);
  // spawn + inherited stdio so curl's --progress-bar updates the terminal live.
  const child = spawn('curl', buildCurlArgs(url, headers), { cwd: tempDir, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', (err) => {
    console.error(`❌ Download failed: ${err.message}`);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });
  child.on('close', (code) => {
    if (code === 0) {
      uploadAndCleanup(tempDir, course, lecture, kind, 'curl');
    } else {
      console.error(`❌ Download failed: curl exited with code ${code}`);
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
  console.log(`\n📥 yt-dlp downloading to temp: ${tempDir}`);
  const bytes = await probeYoutubeSize(url);
  console.log(`📦 Expected size: ${bytes ? formatBytes(bytes) : 'unknown'}`);
  // -o video.%(ext)s + --merge-output-format mp4 -> final file is `video.mp4`.
  // --no-playlist keeps a playlist-context URL to the single current video.
  // Recent yt-dlp needs a JS runtime to evaluate YouTube's player script;
  // only `deno` is auto-enabled, so point it at the `node` we already have.
  // `--quiet --no-warnings --progress --newline` is the documented combo for
  // "suppress [youtube]/[info]/[Merger] chatter but still stream the progress bar."
  const args = [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--quiet', '--no-warnings', '--progress',
    '-o', 'video.%(ext)s',
    url,
  ];
  // spawn + inherited stdio so yt-dlp's progress bar streams live.
  const child = spawn('yt-dlp', args, { cwd: tempDir, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', (err) => {
    console.error(`❌ yt-dlp failed: ${err.message}`);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });
  child.on('close', (code) => {
    if (code === 0) {
      uploadAndCleanup(tempDir, course, lecture, kind, 'yt-dlp');
    } else {
      console.error(`❌ yt-dlp failed: exited with code ${code}`);
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
  console.log(`\n📥 PDF upload received: ${formatBytes(buf.length)} for ${course}/${lecture} (kind=${kind})`);
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
      console.error(`❌ PDF upload to database failed: ${msg}`);
      return send(res, 502, { error: msg });
    }
    console.log(`✅ Uploaded ${MATERIAL_FILENAME} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
    send(res, 200, { status: 'PDF uploaded', target: `${course}/${lecture}` });
  } catch (err) {
    console.error(`❌ PDF upload to database failed: ${err.message}`);
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
    console.error(e);
    send(res, 500, { error: e.message ?? 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🎧 Downloader listening on port ${PORT}`);
  console.log(`📁 DATABASE_URL: ${DATABASE_URL}`);
  console.log(`==========================================\n`);
});
