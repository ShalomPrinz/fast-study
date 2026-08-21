// What an arbitrary off-site link actually is, decided the cheapest way that still answers
// honestly. Two tiers only: a URL that already names a file needs no request at all, and
// everything else costs one header-only round-trip. Never throws — a link this can't read is
// `media: null`, which lists as 'unsupported' rather than killing the row.
import { classifyFilename, filenameFromDisposition } from './fileMedia.js';
import { cacheProbe, getProbe } from '../core/probeCache.js';

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
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
  } catch {
    return '';
  }
}

// Content-Type → media, params stripped. `text/html` is a share page or a syllabus doc, never a
// file this service can fetch, so it is an honest null rather than an unknown to retry.
function classifyContentType(header) {
  const mime = String(header ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!mime || mime === 'text/html') return null;
  if (mime.startsWith('video/')) return 'video';
  return mime === 'application/pdf' ? 'material' : null;
}

// Headers for a URL without pulling the body: HEAD first, then a one-byte ranged GET for the
// hosts that answer HEAD with 405/403. Null when neither works — offline, DNS, TLS, 404.
async function fetchHeaders(url) {
  for (const init of [{ method: 'HEAD' }, { method: 'GET', headers: { Range: 'bytes=0-0' } }]) {
    try {
      const res = await fetch(url, { ...init, redirect: 'follow' });
      await res.body?.cancel().catch(() => {});
      if (res.ok) return res;
    } catch {
      // fall through to the next attempt, then to the null verdict
    }
  }
  return null;
}

/**
 * Resolve what a link is before downloading it. Tier 1 reads the URL's own filename; tier 2 asks
 * the host for `Content-Disposition` / `Content-Type`. Memoized per normalized URL for the
 * session, unusable verdicts included; `force` re-probes.
 * @param {string} url
 * @param {{ force?: boolean }} [opts] force = ignore the cached verdict and probe fresh.
 * @returns {Promise<{ probeKey: string, media: 'video'|'material'|null, filename: string|null }>}
 *   media null = a link this service can't use (a share page, an archive, an unreachable host).
 */
export async function probeUrl(url, { force = false } = {}) {
  const probeKey = probeKeyForUrl(url);

  const cached = force ? undefined : getProbe(probeKey);
  if (cached) return { probeKey, media: cached.media, filename: cached.filename ?? null };

  const named = pathFilename(url);
  const fromPath = classifyFilename(named);
  if (fromPath) {
    cacheProbe(probeKey, fromPath, named);
    return { probeKey, media: fromPath, filename: named };
  }

  const res = await fetchHeaders(url);
  if (!res) {
    cacheProbe(probeKey, null, null);
    return { probeKey, media: null, filename: null };
  }

  // The name the host states beats the one the URL implies: a redirect to a CDN path can be
  // opaque while the disposition still says `lecture3.mp4`.
  const filename =
    filenameFromDisposition(res.headers.get('content-disposition')) ||
    pathFilename(res.url) ||
    null;
  const media = classifyFilename(filename) ?? classifyContentType(res.headers.get('content-type'));
  cacheProbe(probeKey, media, filename);
  return { probeKey, media, filename };
}
