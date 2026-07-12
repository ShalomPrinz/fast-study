import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ -> auto/ -> downloader/ -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');

// Tiny inline .env parser (same pattern as server.js — no dotenv dep).
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

loadEnv(path.join(REPO_ROOT, '.env'));

// server.js base URL for the download phase (POST /download, /download-youtube).
export const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3052';

// Port for this package's own HTTP service (src/server.js). Env-overridable.
export const AUTODL_PORT = Number(process.env.AUTODL_PORT ?? 3053);

// Entry URL for the headed BIU login (the UI Connect flow carries no course URL).
// Overridable; the real BIU login/course host should be set here or via env.
export const AUTH_ENTRY_URL = process.env.AUTODL_AUTH_URL ?? 'https://lemida.biu.ac.il/';
