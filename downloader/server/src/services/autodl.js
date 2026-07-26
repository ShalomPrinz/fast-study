import { AUTODL_URL } from '../config.js';

// Silent auth-recovery edge to auto service
export async function recaptureItem({ ref, course, name, kind }) {
  try {
    const res = await fetch(`${AUTODL_URL}/download-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, course, name, kind, only: true, forceCapture: true }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: { error: err.message } };
  }
}
