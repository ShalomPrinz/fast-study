// What an arbitrary off-site link actually is, from one header-only round trip. Never throws — the
// caller decides what a verdict means, and only a CERTAIN one is remembered (see `certain` below).
import { NAMED_FILE, classifyFilename, filenameFromDisposition } from './fileMedia.js';
import { cacheProbe, getProbe } from '../core/probeCache.js';

// Node's fetch has no default timeout, and `server/` walks a section queue through /resolve one
// row at a time — a hung host would stall the whole bulk run. Generous for a slow CDN.
const PROBE_TIMEOUT_MS = 15_000;

/**
 * The cache key for a URL: everything but the fragment, which no server ever sees.
 * @param {string} url
 * @returns {string}
 */
export function probeKeyForUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return String(url);
  }
}

// Last path segment of a URL, or '' — the half of a URL that can name a file.
function pathFilename(url) {
  try {
    const path = new URL(url).pathname;
    const last = path.slice(path.lastIndexOf('/') + 1);
    // A malformed %-escape in the path is not worth failing the probe over — use it as-is.
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return '';
  }
}

// Content-Type → a verdict, or undefined for "says nothing": `text/html` is a definite no, while a
// generic binary type is the CDN not knowing either and must not harden into "unsupported".
function classifyContentType(header) {
  const mime = String(header ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (mime === 'text/html') return null;
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'material';
  return undefined;
}

// The host saying there is nothing to fetch — a fact about the LINK. Every other refusal (403,
// 429, 5xx) may pass next time, so those stay uncertain.
const DEAD_STATUSES = new Set([404, 410]);

// Headers without the body: HEAD, then a one-byte ranged GET for hosts that reject HEAD. `'dead'`
// when the host says the link is gone; null when nothing was learned at all.
async function fetchHeaders(url) {
  let dead = false;
  for (const init of [{ method: 'HEAD' }, { method: 'GET', headers: { Range: 'bytes=0-0' } }]) {
    try {
      const res = await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => {});
      if (res.ok) return res;
      if (DEAD_STATUSES.has(res.status)) dead = true;
    } catch {
      // fall through to the next attempt, then to the verdict the statuses so far support
    }
  }
  return dead ? 'dead' : null;
}

// Does this name carry an extension to route on? A bare CDN path segment ('asset') does not.
function isNamedFile(name) {
  return NAMED_FILE.test(String(name ?? ''));
}

/**
 * Resolve what a link is from one header-only round trip: Content-Disposition name, then
 * Content-Type, then the URL's filename. Only `certain` verdicts are memoized. See docs/BROWSING.md.
 * @param {string} url
 * @param {{ force?: boolean }} [opts] force = ignore the cached verdict and probe fresh.
 * @returns {Promise<{ probeKey: string, media: 'video'|'material'|null, filename: string|null,
 *                     certain: boolean, reason?: string }>} media null = this service can't use
 *   the link; reason names why when the link itself is the problem.
 */
export async function probeUrl(url, { force = false } = {}) {
  const probeKey = probeKeyForUrl(url);

  const cached = force ? undefined : getProbe(probeKey);
  if (cached)
    return {
      probeKey,
      media: cached.media,
      filename: cached.filename ?? null,
      certain: true,
      reason: cached.reason,
    };

  const res = await fetchHeaders(url);
  if (res === 'dead') {
    cacheProbe(probeKey, null, null, 'missing');
    return { probeKey, media: null, filename: null, certain: true, reason: 'missing' };
  }
  if (!res) return { probeKey, media: null, filename: null, certain: false };

  const stated = filenameFromDisposition(res.headers.get('content-disposition'));
  // The redirect target names the file more often than the link does — a share URL resolves to the
  // CDN path — so prefer it, and fall back to the original link when it is opaque.
  const guessed = pathFilename(res.url) || pathFilename(url) || null;
  const byType = classifyContentType(res.headers.get('content-type'));

  let media = null;
  let certain = true;
  if (isNamedFile(stated)) media = classifyFilename(stated);
  else if (byType !== undefined) media = byType;
  else if (isNamedFile(guessed)) media = classifyFilename(guessed);
  else certain = false;

  const filename = stated || guessed;
  if (certain) cacheProbe(probeKey, media, filename);
  return { probeKey, media, filename, certain };
}
