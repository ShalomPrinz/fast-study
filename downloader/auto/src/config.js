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

// SERVER_URL is for the later download phase (POST /download); unused in MVP.
export const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3052';
