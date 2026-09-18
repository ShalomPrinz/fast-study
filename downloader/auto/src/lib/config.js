import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/lib/ -> src/ -> auto/ -> downloader/ -> repo root. No override: dotenv must not clobber
// vars already set in the process environment.
dotenv.config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

// Default listen port; FASTSTUDY_PORT in the environment wins (@faststudy/runtime's serve).
export const AUTODL_PORT = Number(process.env.AUTODL_PORT ?? 3053);

// CORS origins: the Vite dev server and the packaged app's frozen 'app://bundle' origin,
// which an app:// page sends host-only, with no trailing slash.
export const ALLOWED_ORIGINS = ['http://localhost:5173', 'app://bundle'];
