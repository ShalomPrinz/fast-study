import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/lib/ -> src/ -> auto/ -> downloader/ -> repo root. No override: dotenv must not clobber
// already-set process.env vars (matches the old `if (process.env[...] === undefined)` guard).
dotenv.config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

// Port for this package's own HTTP service (src/server.js). Env-overridable.
export const AUTODL_PORT = Number(process.env.AUTODL_PORT ?? 3053);

// CORS origin: the Vite dev server; this service only serves that SPA.
export const ALLOWED_ORIGIN = 'http://localhost:5173';
