// What an arbitrary off-site link actually is, decided the cheapest way that still answers
// honestly. Two tiers only: a URL that already names a file needs no request at all, and
// everything else costs one header-only round-trip. Never throws — the caller decides what a
// verdict means, and only a CERTAIN one is remembered (see `certain` below).
import { NAMED_FILE, classifyFilename, filenameFromDisposition } from './fileMedia.js';
import { cacheProbe, getProbe } from '../core/probeCache.js';

// One probe must not outlive a user's patience, and `server/` walks a section queue through
// /resolve one row at a time — Node's fetch has no default timeout, so a hung host would stall
// the whole bulk run. Generous enough for a slow CDN's first byte.
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

// Content-Type → a verdict this service can stand behind, or undefined for "says nothing".
// `text/html` is a share page or a syllabus doc — a definite no. A generic binary type
// (application/octet-stream, and anything else unrecognized) is the CDN saying it doesn't know
// either, which must not harden into a permanent "unsupported".
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

// Headers for a URL without pulling the body: HEAD first, then a one-byte ranged GET for the
// hosts that answer HEAD with 405/403. Null when neither works — offline, DNS, TLS, timeout, 404.
async function fetchHeaders(url) {
  for (const init of [{ method: 'HEAD' }, { method: 'GET', headers: { Range: 'bytes=0-0' } }]) {
    try {
      const res = await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => {});
      if (res.ok) return res;
    } catch {
      // fall through to the next attempt, then to the uncertain verdict
    }
  }
  return null;
}

/**
 * Resolve what a link is before downloading it. Tier 1 reads the URL's own filename; tier 2 asks
 * the host for `Content-Disposition` / `Content-Type`.
 *
 * `certain` separates a verdict about the FILE from a failure to reach it: an unreachable host, or
 * a nameless response typed only as generic binary, is `{ media: null, certain: false }` — worth
 * retrying, never remembered. Only certain verdicts are memoized (per normalized URL, for the
 * session, the definite `null`s included), so a row can never be permanently greyed out by one bad
 * moment on the network. A URL that names its own file is decided from the name; `force` skips the
 * cache but cannot change that answer, since no request produced it.
 * @param {string} url
 * @param {{ force?: boolean }} [opts] force = ignore the cached verdict and probe fresh.
 * @returns {Promise<{ probeKey: string, media: 'video'|'material'|null, filename: string|null,
 *                     certain: boolean }>} media null = this service can't use the link.
 */
export async function probeUrl(url, { force = false } = {}) {
  const probeKey = probeKeyForUrl(url);

  const cached = force ? undefined : getProbe(probeKey);
  if (cached)
    return { probeKey, media: cached.media, filename: cached.filename ?? null, certain: true };

  const named = pathFilename(url);
  const fromPath = classifyFilename(named);
  if (fromPath) {
    cacheProbe(probeKey, fromPath, named);
    return { probeKey, media: fromPath, filename: named, certain: true };
  }

  const res = await fetchHeaders(url);
  if (!res) return { probeKey, media: null, filename: null, certain: false };

  // The name the host states beats the one the URL implies: a redirect to a CDN path can be
  // opaque while the disposition still says `lecture3.mp4`.
  const filename =
    filenameFromDisposition(res.headers.get('content-disposition')) ||
    pathFilename(res.url) ||
    null;

  const byName = classifyFilename(filename);
  const byType = classifyContentType(res.headers.get('content-type'));
  // A name carrying an extension settles it either way — `L1.zip` is a definite no, not a maybe.
  const namedFile = NAMED_FILE.test(String(filename ?? ''));
  const media = byName ?? byType ?? null;
  const certain = namedFile || byType !== undefined;

  if (certain) cacheProbe(probeKey, media, filename);
  return { probeKey, media, filename, certain };
}
