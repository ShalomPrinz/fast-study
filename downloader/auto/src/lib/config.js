import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/lib/ -> src/ -> auto/ -> downloader/ -> repo root. No override: dotenv must not clobber
// already-set process.env vars (matches the old `if (process.env[...] === undefined)` guard).
dotenv.config({ path: path.resolve(__dirname, '../../../..', '.env') });

// server.js base URL for the download phase (POST /download, /download-youtube).
export const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3052';

// Port for this package's own HTTP service (src/server.js). Env-overridable.
export const AUTODL_PORT = Number(process.env.AUTODL_PORT ?? 3053);

// Entry URL for the headed BIU login (the UI Connect flow carries no course URL).
// Overridable; the real BIU login/course host should be set here or via env.
export const AUTH_ENTRY_URL = process.env.AUTODL_AUTH_URL ?? 'https://lemida.biu.ac.il/';
