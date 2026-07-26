import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ -> server/ -> downloader/ -> repo root. No override: dotenv must not clobber
// vars already set in the process environment.
dotenv.config({ path: path.resolve(__dirname, '../../..', '.env'), quiet: true });

export const PORT = Number(process.env.DOWNLOADER_PORT) || 3052;

// CORS is locked to this one extension ID; a reloaded extension with a new ID is
// blocked until this (or DOWNLOADER_EXTENSION_ID) matches.
export const EXTENSION_ID =
  process.env.DOWNLOADER_EXTENSION_ID ?? 'lnhmnpikihooldojjihejacblbgjkdlg';

export const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
export const DATABASE_URL = process.env.DATABASE_URL ?? 'http://localhost:8001';
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';
export const AUTODL_URL = process.env.AUTODL_URL ?? 'http://localhost:3053';

// Saved names the backend's /run/audio and the material contract expect.
export const VIDEO_FILENAME = 'video.mp4';
export const MATERIAL_FILENAME = 'material.pdf';
