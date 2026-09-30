// The pre-login check: does a pasted link lead to a Moodle that serves the mobile web service?
// Asked of the no-login public config, so it needs no account. See docs/MOODLE.md § Checking a site.
import {
  NotMoodleError,
  WsBlockedError,
  WsError,
  WsRedirectError,
  getPublicConfig,
} from './wsClient.js';
import { candidateRoots, normalizeSite } from './site.js';

const unsupported = (site, reason) => ({
  status: 'unsupported',
  site,
  code: 'moodle_site_unsupported',
  params: { site, reason },
});

// Why a candidate could not be asked, as the `detail` an unverified answer carries.
function failureDetail(err) {
  if (err instanceof WsBlockedError) return 'site_blocked';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  return 'network';
}

// The Moodle root a redirect points at: the AJAX endpoint's own root, else the target as a pasted root.
function redirectRoot(location) {
  if (!location) return null;
  const u = new URL(location);
  const at = u.pathname.indexOf('/lib/ajax/service-nologin.php');
  if (at >= 0) return normalizeSite(`${u.origin}${u.pathname.slice(0, at)}`);
  return normalizeSite(location);
}

// → { root, config } or { root, refused }, `root` being the host that answered after at most one redirect.
// A second redirect, or a non-Moodle target, stays the bot wall: a wall never answers Moodle JSON.
async function askRoot(root, timeoutMs) {
  const ask = (at) =>
    getPublicConfig(at, { timeoutMs }).then(
      (config) => ({ root: at, config }),
      (err) => {
        if (err instanceof WsError) return { root: at, refused: true };
        throw err;
      },
    );
  try {
    return await ask(root);
  } catch (err) {
    const target = err instanceof WsRedirectError && redirectRoot(err.location);
    if (!target) throw err;
    return ask(target).catch((e) => {
      throw e instanceof NotMoodleError || e instanceof WsBlockedError ? err : e;
    });
  }
}

/**
 * Probe each candidate root of `url` in turn; the first one that answers as Moodle decides.
 * → { status:'supported'|'unsupported'|'unverified', site, code?, params? }, or null for a non-URL.
 * A bot wall or a network failure on any candidate makes "none is Moodle" unprovable → unverified.
 */
export async function probeSite(url, { timeoutMs } = {}) {
  const roots = candidateRoots(url);
  if (!roots.length) return null;
  let unreachable = null;
  for (const candidate of roots) {
    let answer;
    try {
      answer = await askRoot(candidate, timeoutMs);
    } catch (err) {
      if (err instanceof NotMoodleError) continue;
      unreachable ??= failureDetail(err);
      continue;
    }
    const { root, config, refused } = answer;
    // Moodle answered, but refused the mobile app's own first question.
    if (refused) return unsupported(root, 'mobile_service_off');
    const site = normalizeSite(config.wwwroot ?? '') ?? root;
    if (!Number(config.enablemobilewebservice)) return unsupported(site, 'mobile_service_off');
    if (Number(config.maintenanceenabled)) return unsupported(site, 'maintenance');
    return { status: 'supported', site };
  }
  if (unreachable) {
    return {
      status: 'unverified',
      site: roots[0],
      params: { site: roots[0], detail: unreachable },
    };
  }
  return unsupported(roots[0], 'not_moodle');
}
