import http from 'node:http';
import { exec } from 'node:child_process';
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

function rewriteCurl(cmd) {
  return cmd.replace(/\s+--output\s+(?:"[^"]*"|'[^']*'|\S+)/g, '') + ` --output "${VIDEO_FILENAME}"`;
}

function runDownload(cmd, cwd) {
  console.log(`\n📥 Downloading to: ${cwd}`);
  exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error) => {
    if (error) {
      console.error(`❌ Download failed: ${error.message}`);
      return;
    }
    console.log(`✅ Saved ${VIDEO_FILENAME} in ${cwd}`);
  });
}

async function handleDownload(req, res) {
  const { command, course, lecture, kind = 'lecture' } = JSON.parse(await readBody(req));

  if (!command || !command.startsWith('curl')) {
    return send(res, 400, { error: 'Invalid curl command' });
  }
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return send(res, 400, { error: 'course and lecture are required' });
  }
  if (kind !== 'lecture' && kind !== 'recitation') {
    return send(res, 400, { error: `invalid kind: ${kind}` });
  }

  const dir = lectureDir(course, lecture, kind);
  fs.mkdirSync(dir, { recursive: true });
  runDownload(rewriteCurl(command), dir);
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
