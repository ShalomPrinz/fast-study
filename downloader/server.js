import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

loadEnv(path.join(REPO_ROOT, '.env'));
const DATA_ROOT = process.env.DATA_ROOT;
if (!DATA_ROOT) throw new Error('DATA_ROOT is not set in .env');

const PORT = 3052;
const EXTENSION_ID = 'kebkiehjoihdofnobkbifjcihnifibdo';
const RECITATIONS_DIR = 'Recitations';
const VIDEO_FILENAME = 'video.mp4';

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

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function listCourses() {
  return listDirs(DATA_ROOT).map((course) => {
    const coursePath = path.join(DATA_ROOT, course);
    const lectures = listDirs(coursePath).filter((n) => n !== RECITATIONS_DIR);
    const recitations = listDirs(path.join(coursePath, RECITATIONS_DIR));
    return { name: course, lectures, recitations };
  });
}

function isSafeName(name) {
  return typeof name === 'string'
    && name.length > 0
    && !name.includes('/')
    && !name.includes('\\')
    && name !== '.'
    && name !== '..';
}

function lectureDir(course, lecture, kind) {
  return kind === 'recitation'
    ? path.join(DATA_ROOT, course, RECITATIONS_DIR, lecture)
    : path.join(DATA_ROOT, course, lecture);
}

// Range/conditional headers cause curl to fetch a partial body — the file
// then lacks the MP4 header at offset 0 and is unplayable.
const SKIP_HEADERS = new Set([
  'range', 'if-range', 'if-none-match', 'if-modified-since',
  'host', 'content-length',
]);

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

function runDownload(args, cwd) {
  console.log(`\n📥 Downloading to: ${cwd}`);
  // spawn + inherited stdio so curl's --progress-bar updates the terminal live.
  const child = spawn('curl', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', (err) => console.error(`❌ Download failed: ${err.message}`));
  child.on('close', (code) => {
    if (code === 0) console.log(`✅ Saved ${VIDEO_FILENAME} in ${cwd}`);
    else console.error(`❌ Download failed: curl exited with code ${code}`);
  });
}

function runYoutubeDownload(url, cwd) {
  console.log(`\n📥 yt-dlp downloading to: ${cwd}`);
  // -o video.%(ext)s + --merge-output-format mp4 -> final file is `video.mp4`.
  // --no-playlist keeps a playlist-context URL to the single current video.
  // Recent yt-dlp needs a JS runtime to evaluate YouTube's player script;
  // only `deno` is auto-enabled, so point it at the `node` we already have.
  const args = [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '-o', 'video.%(ext)s',
    url,
  ];
  // spawn + inherited stdio so yt-dlp's `[download] X%` lines stream live.
  const child = spawn('yt-dlp', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', (err) => console.error(`❌ yt-dlp failed: ${err.message}`));
  child.on('close', (code) => {
    if (code === 0) console.log(`✅ Saved ${VIDEO_FILENAME} in ${cwd}`);
    else console.error(`❌ yt-dlp failed: exited with code ${code}`);
  });
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

  const dir = lectureDir(course, lecture, kind);
  fs.mkdirSync(dir, { recursive: true });
  runYoutubeDownload(url, dir);
  send(res, 200, { status: 'Downloading in background...', target: dir });
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

  const dir = lectureDir(course, lecture, kind);
  fs.mkdirSync(dir, { recursive: true });
  runDownload(buildCurlArgs(url, headers), dir);
  send(res, 200, { status: 'Downloading in background...', target: dir });
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
      return send(res, 200, listCourses());
    }
    if (req.method === 'POST' && req.url === '/download') {
      return await handleDownload(req, res);
    }
    if (req.method === 'POST' && req.url === '/download-youtube') {
      return await handleDownloadYoutube(req, res);
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
  console.log(`📁 DATA_ROOT: ${DATA_ROOT}`);
  console.log(`==========================================\n`);
});
