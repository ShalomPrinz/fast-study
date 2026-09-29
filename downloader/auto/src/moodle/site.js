// The one configured Moodle site: seeded from MOODLE_SITE at boot, replaced by POST /config.
// A site is an origin plus an optional path prefix (Moodle may live under /moodle), no trailing slash.
import '../lib/config.js'; // dotenv first, so a MOODLE_SITE in the repo-root .env is seen below

/** `url` as a site root — origin + path, no query, no trailing slash — or null when it is not http(s). */
export function normalizeSite(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

let current = normalizeSite(process.env.MOODLE_SITE ?? '');

/** The configured site, or null when none is. */
export function currentSite() {
  return current;
}

/** Replace the configured site (already normalized); null clears it. */
export function setCurrentSite(site) {
  current = site || null;
}

/** True when `url` lives under `site`: same origin, and its path is the site's prefix or below it. */
export function underSite(url, site) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const root = new URL(site);
  if (u.origin !== root.origin) return false;
  const prefix = root.pathname.replace(/\/+$/, '');
  return prefix === '' || u.pathname === prefix || u.pathname.startsWith(`${prefix}/`);
}

// Moodle's own top-level paths; whatever comes before one in a pasted link is the site's prefix.
// `/mod/` too, since an activity link is as likely a paste as a course link.
const MOODLE_PATHS = ['/course/', '/login/', '/my/', '/admin/', '/mod/'];

/**
 * Site roots a pasted link could belong to, most likely first: the origin, then each path prefix
 * that sits before a Moodle path segment. A bare root pasted with its own prefix comes last.
 * @returns {string[]}  empty when `url` is not an http(s) URL
 */
export function candidateRoots(url) {
  const pasted = normalizeSite(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  if (!pasted) return [];
  const u = new URL(pasted);
  const roots = [u.origin];
  const path = u.pathname.replace(/\/+$/, '');
  for (const marker of MOODLE_PATHS) {
    const at = `${path}/`.indexOf(marker);
    if (at > 0) roots.push(`${u.origin}${path.slice(0, at)}`);
  }
  // A path with no Moodle segment in it may itself be the prefix (https://x.ac.il/moodle), less a
  // trailing script (…/moodle/index.php).
  if (path && !MOODLE_PATHS.some((m) => `${path}/`.includes(m))) {
    const dir = path.replace(/\/[^/]*\.php$/, '');
    if (dir) roots.push(`${u.origin}${dir}`);
  }
  return [...new Set(roots)];
}
