import http from 'node:http';
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOAD_DIR = path.resolve(__dirname, '..');
const PORT = 3052;
const EXTENSION_ID = 'kebkiehjoihdofnobkbifjcihnifibdo';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', `chrome-extension://${EXTENSION_ID}`);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function runDownload(curlCmd) {
  console.log('\n📥 Received new video from Chrome!');
  console.log(`🚀 Starting download in: ${DOWNLOAD_DIR}`);

  exec(curlCmd, { cwd: DOWNLOAD_DIR, maxBuffer: 10 * 1024 * 1024 }, (error) => {
    if (error) {
      console.error(`❌ Download Failed: ${error.message}`);
      return;
    }
    console.log('✅ Download Complete and saved!');
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/download') {
    res.writeHead(404).end();
    return;
  }

  try {
    const { command } = JSON.parse(await readBody(req));

    if (!command || !command.startsWith('curl')) {
      res.writeHead(400).end('Invalid command');
      return;
    }

    runDownload(command);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Downloading in background...' }));
  } catch {
    res.writeHead(500).end('Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🎧 Node Auto-Downloader is actively listening on port ${PORT}!`);
  console.log(`📁 Saving all videos to: ${DOWNLOAD_DIR}`);
  console.log(`Leave this terminal window open/minimized.`);
  console.log(`==========================================\n`);
});
