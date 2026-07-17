// Opaque token the frontend round-trips without parsing. Encodes the whole internal
// Recording so the HTTP surface stays mechanism-agnostic and stateless (no server-side
// map). 'strategy'/'pageUrl'/'videostream'/etc. must never appear in a response. See docs/BROWSING.md.

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
