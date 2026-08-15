import { AUTODL_URL } from '../config.js';

// auto/ answered with targets. Anything else — its 4xx contract, a 5xx, or status 0
// (unreachable) — is a failure to forward or report.
export function resolved(status) {
  return status >= 200 && status < 300;
}

/**
 * Resolver edge to auto/ (3053): a discovery `ref` → `{ media, targets }`, the caps this
 * server then runs as jobs. A non-2xx is RETURNED, never thrown, so `/download-item` can
 * forward auto's status and body verbatim (its 401/409/422 contract is the frontend's).
 * @param {{ ref: string, course: string, name: string, kind: string,
 *           only?: boolean, forceCapture?: boolean }} args
 * @returns {Promise<{ status: number, body: object|null }>} status 0 = unreachable
 */
export async function resolve({ ref, course, name, kind, only = false, forceCapture = false }) {
  try {
    const res = await fetch(`${AUTODL_URL}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, course, name, kind, only, forceCapture }),
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
