import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ -> server/ -> downloader/ -> repo root. No override: dotenv must not clobber
// vars already set in the process environment.
dotenv.config({ path: path.resolve(__dirname, '../../..', '.env'), quiet: true });

export const PORT = Number(process.env.DOWNLOADER_PORT) || 3052;

// Unset allowlists no extension origin at all, which is what a packaged build always is.
// A dev loading the unpacked extension sets this to the ID Chrome assigned it.
export const EXTENSION_ID = process.env.DOWNLOADER_EXTENSION_ID;

export const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
export const DATABASE_URL = process.env.DATABASE_URL ?? 'http://localhost:8001';
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';
export const AUTODL_URL = process.env.AUTODL_URL ?? 'http://localhost:3053';

// Saved video name the backend's /run/audio expects.
export const VIDEO_FILENAME = 'video.mp4';
// Temp-dir name for a downloaded PDF only — the database allocates the on-disk
// material name (material.pdf, material.2.pdf, …) when the bytes are uploaded.
export const MATERIAL_TEMP_FILENAME = 'material.pdf';
