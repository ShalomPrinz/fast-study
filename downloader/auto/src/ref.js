// Opaque token the frontend round-trips without ever parsing it. It encodes the
// internal Recording (strategy / pageUrl / redirect target) so the HTTP surface
// stays mechanism-agnostic: 'strategy', 'pageUrl', 'playlist', 'youtube', and
// 'videostream' must never appear in any response the frontend sees. Stateless —
// the whole Recording lives in the token, so there's no server-side map to keep.

/** @param {object} recording  internal Recording → base64url token. */
export function encodeRef(recording) {
  return Buffer.from(JSON.stringify(recording), 'utf8').toString('base64url');
}

/**
 * Decode a ref back to its internal Recording. Returns null on any malformed
 * token (bad base64 / not JSON) so handlers can 400 instead of throwing.
 * @param {string} ref
 * @returns {object|null}
 */
export function decodeRef(ref) {
  try {
    if (typeof ref !== 'string' || !ref) return null;
    return JSON.parse(Buffer.from(ref, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
