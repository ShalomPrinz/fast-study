import { BACKEND_URL } from '../config.js';

// Per-tool buckets: a curl-replayed in-site .mp4 and a yt-dlp YouTube fetch have very
// different throughput curves, and averaging them into one regression makes both ETAs worse.
const OPERATIONS = { curl: 'download:curl', 'yt-dlp': 'download:ytdlp' };

// Fire-and-forget sample for the backend's regression ETA.
export function recordDownloadTiming(tool, bytes, seconds) {
  const operation = OPERATIONS[tool];
  if (!operation || !Number.isFinite(bytes) || bytes <= 0) return;
  fetch(`${BACKEND_URL}/timing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, file_size_bytes: bytes, duration_seconds: seconds }),
  }).catch(() => {});
}
