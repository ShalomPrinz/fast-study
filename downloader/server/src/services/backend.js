import { BACKEND_URL } from '../config.js';
import { peerHeaders } from '@faststudy/runtime';

// Announce a stored video so the backend can apply its auto-run policy. Silent on failure: a dead
// backend must never fail a completed download (docs/DATABASE.md).
export function reportVideoArrived(course, lecture, kind) {
  const url = `${BACKEND_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/video-arrived?kind=${encodeURIComponent(kind)}`;
  fetch(url, { method: 'POST', headers: peerHeaders() }).catch(() => {});
}
