import { BACKEND_URL } from '../config.js';
import { peerHeaders } from '@faststudy/runtime';

// Per-tool buckets: a curl-replayed in-site .mp4 and a yt-dlp YouTube fetch have very
// different throughput curves, and averaging them into one regression makes both ETAs worse.
export const OPERATIONS = { curl: 'download:curl', 'yt-dlp': 'download:ytdlp' };

// The download:* operation a tool records under, or null for an unknown/absent tool.
export function operationForTool(tool) {
  return OPERATIONS[tool] ?? null;
}

// Fire-and-forget sample for the backend's regression ETA.
export function recordDownloadTiming(tool, bytes, seconds) {
  const operation = OPERATIONS[tool];
  if (!operation || !Number.isFinite(bytes) || bytes <= 0) return;
  fetch(`${BACKEND_URL}/timing`, {
    method: 'POST',
    headers: peerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ operation, file_size_bytes: bytes, duration_seconds: seconds }),
  }).catch(() => {});
}
