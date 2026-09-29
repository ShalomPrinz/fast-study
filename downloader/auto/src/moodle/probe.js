// The pre-login check: does a pasted link lead to a Moodle that serves the mobile web service?
// Asked of the no-login public config, so it needs no account. See docs/MOODLE.md § Checking a site.
import { NotMoodleError, WsBlockedError, WsError, getPublicConfig } from './wsClient.js';
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

/**
 * Probe each candidate root of `url` in turn; the first one that answers as Moodle decides.
 * → { status:'supported'|'unsupported'|'unverified', site, code?, params? }, or null for a non-URL.
 * A bot wall or a network failure on any candidate makes "none is Moodle" unprovable → unverified.
 */
export async function probeSite(url, { timeoutMs } = {}) {
  const roots = candidateRoots(url);
  if (!roots.length) return null;
  let unreachable = null;
  for (const root of roots) {
    let config;
    try {
      config = await getPublicConfig(root, { timeoutMs });
    } catch (err) {
      if (err instanceof NotMoodleError) continue;
      // Moodle answered, but refused the mobile app's own first question.
      if (err instanceof WsError) return unsupported(root, 'mobile_service_off');
      unreachable ??= failureDetail(err);
      continue;
    }
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
