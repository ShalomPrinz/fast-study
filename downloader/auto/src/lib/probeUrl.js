// What an arbitrary off-site link actually is, from one header-only round trip. Never throws — the
// caller decides what a verdict means, and only a CERTAIN one is remembered (see `certain` below).
import { NAMED_FILE, classifyFilename, filenameFromDisposition } from './fileMedia.js';
import { cacheProbe, getProbe } from '../core/probeCache.js';
import { enterMoodle, gateError } from '../moodle/gate.js';
import { onMoodleHost } from '../moodle/site.js';

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

const MAX_REDIRECTS = 10;

// Follow redirects by hand, so a hop onto the Moodle host — the link itself, or an off-site link
// that redirects there — goes through the gate first. → { res, url } with the final hop's URL.
async function fetchFollowing(url, init) {
  let at = url;
  for (let hop = 0; ; hop++) {
    // A probe is Moodle traffic the moment it reaches the Moodle host.
    if (onMoodleHost(at)) await enterMoodle(at);
    const res = await fetch(at, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location || hop === MAX_REDIRECTS) return { res, url: at };
    await res.body?.cancel().catch(() => {});
    at = new URL(location, at).toString();
  }
}

// Headers without the body: HEAD, then a one-byte ranged GET for hosts that reject HEAD. `'dead'`
// when the host says the link is gone; null when nothing was learned at all.
async function fetchHeaders(url) {
  let dead = false;
  for (const init of [{ method: 'HEAD' }, { method: 'GET', headers: { Range: 'bytes=0-0' } }]) {
    try {
      const answer = await fetchFollowing(url, init);
      await answer.res.body?.cancel().catch(() => {});
      if (answer.res.ok) return answer;
      if (DEAD_STATUSES.has(answer.res.status)) dead = true;
    } catch (e) {
      if (gateError(e)) throw e; // never a verdict about the link
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
 *                     certain: boolean, reason?: string, size?: number|null, finalUrl?: string }>}
 *   finalUrl is where the redirects ended. media null = this service can't use
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
      finalUrl: cached.finalUrl,
    };

  const answer = await fetchHeaders(url);
  if (answer === 'dead') {
    cacheProbe(probeKey, null, null, 'missing');
    return { probeKey, media: null, filename: null, certain: true, reason: 'missing' };
  }
  if (!answer) return { probeKey, media: null, filename: null, certain: false };
  const { res, url: finalUrl } = answer;

  const stated = filenameFromDisposition(res.headers.get('content-disposition'));
  // The redirect target names the file more often than the link does — a share URL resolves to the
  // CDN path — so prefer it, and fall back to the original link when it is opaque.
  const guessed = pathFilename(finalUrl) || pathFilename(url) || null;
  const byType = classifyContentType(res.headers.get('content-type'));

  let media = null;
  let certain = true;
  if (isNamedFile(stated)) media = classifyFilename(stated);
  else if (byType !== undefined) media = byType;
  else if (isNamedFile(guessed)) media = classifyFilename(guessed);
  else certain = false;

  const filename = stated || guessed;
  if (certain) cacheProbe(probeKey, media, filename, undefined, finalUrl);
  return { probeKey, media, filename, certain, size: sizeOf(res), finalUrl };
}

// The file's full size from a ranged answer's Content-Range, else a whole answer's Content-Length.
function sizeOf(res) {
  const range = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
  if (range) return Number(range[1]);
  const len = res.status === 200 ? res.headers.get('content-length') : null;
  return len ? Number(len) : null;
}
