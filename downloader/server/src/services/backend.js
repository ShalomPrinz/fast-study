import { BACKEND_URL } from '../config.js';

// Announce a video landing on disk so the backend can apply its auto-run policy. Fire-and-forget
// and silent on failure: the bytes are already stored, so a dead backend must never turn a
// completed download into a failed job — the user can still start the pipeline by hand.
export function reportVideoArrived(course, lecture, kind) {
  const url = `${BACKEND_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/video-arrived?kind=${encodeURIComponent(kind)}`;
  fetch(url, { method: 'POST' }).catch(() => {});
}
