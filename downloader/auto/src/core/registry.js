// Two concerns, matched at different granularities: auth for the one configured Moodle site,
// extraction per activity (modType + target).
import { statePath } from '@faststudy/runtime';
import { CodedError } from '../lib/errors.js';
import { MoodleToken } from '../auth/moodleToken.js';
import { currentSite, setCurrentSite, underSite } from '../moodle/site.js';
import { getSession } from '../browser/browserSession.js';
import { VideostreamExtractor } from '../extractors/VideostreamExtractor.js';
import { YoutubePlaylistExtractor } from '../extractors/YoutubePlaylistExtractor.js';
import { GoogleDriveExtractor } from '../extractors/GoogleDriveExtractor.js';
import { ZoomExtractor } from '../extractors/ZoomExtractor.js';
import { MoodleFileExtractor } from '../extractors/MoodleFileExtractor.js';
import { DirectUrlExtractor } from '../extractors/DirectUrlExtractor.js';

// One token file whatever the site: the record names its site, and one for another reads as absent.
const TOKEN_PATH = () => statePath('auth', 'moodle-token.json');

// The configured site's auth, reused across requests so connect()/complete() share one headed
// browser. Rebuilt only when the site changes (setSite).
let cached = null;

/**
 * The configured site and its token auth; throws moodle_site_not_configured when there is none.
 * @returns {{ site: string, auth: MoodleToken }}
 */
export function siteAuth() {
  const site = currentSite();
  if (!site) {
    throw new CodedError(
      'moodle_site_not_configured',
      {},
      'no Moodle site is configured — set moodle_site through POST /config',
    );
  }
  if (cached?.site !== site)
    cached = { site, auth: new MoodleToken({ tokenPath: TOKEN_PATH(), site }) };
  return cached;
}

/**
 * siteAuth(), for a URL that must live under the configured site — the token never leaves it.
 * @returns {{ site: string, auth: MoodleToken }}
 */
export function siteAuthFor(url) {
  const found = siteAuth();
  if (!underSite(url, found.site)) {
    throw new CodedError(
      'course_url_unsupported_site',
      { url, site: found.site },
      `${url} is not on the configured Moodle site ${found.site}`,
    );
  }
  return found;
}

/**
 * Switch to another site (null clears it): forget the old site's token and pending login, and close
 * the plain browser so its autologin cookie cannot carry across. The same site is a no-op.
 * @returns {Promise<boolean>}  whether anything changed
 */
export async function setSite(site) {
  const old = currentSite();
  if ((site || null) === old) return false;
  const auth =
    cached?.auth ?? (old ? new MoodleToken({ tokenPath: TOKEN_PATH(), site: old }) : null);
  cached = null;
  setCurrentSite(site);
  if (auth) await auth.disconnect();
  // Stale leftovers (a token from a site set before this process) go too; loadToken ignores them anyway.
  else await new MoodleToken({ tokenPath: TOKEN_PATH(), site: site ?? '' }).disconnect();
  const session = getSession('plain');
  await session.withLock(() => session.close());
  return true;
}

// Ordered; the first canHandle(activity) wins, and an activity no extractor claims is skipped.
const EXTRACTORS = [
  new VideostreamExtractor(), // modType 'videostream' → in-site .mp4
  new YoutubePlaylistExtractor(), // modType 'url'      → YouTube playlist
  new GoogleDriveExtractor(), // modType 'url'          → single Google Drive file → probed on download
  new ZoomExtractor(), // modType 'zoom' (synthetic) → passcode-gated zoom share .mp4
  new MoodleFileExtractor(), // modType 'resource'     → course-hosted PDF → lecture material
  new DirectUrlExtractor(), // modType 'url' (last)    → any other off-site link → probed on download
];

/**
 * Route a recording echoed back from the frontend to its extractor by strategy
 * (the download phase can't re-parse the course to recover the extractor).
 * @param {import('../extractors/VideoExtractor.js').Recording} recording
 * @returns {import('../extractors/VideoExtractor.js').VideoExtractor | null}
 */
export function resolveExtractorForRecording(recording) {
  return EXTRACTORS.find((ex) => ex.strategy === recording?.strategy) ?? null;
}

/**
 * Route one activity to its extractor. Returns null (no throw) when no strategy
 * handles it — null means skip (e.g. a non-PDF `resource` file).
 * @param {import('../extractors/VideoExtractor.js').Activity} activity
 * @returns {import('../extractors/VideoExtractor.js').VideoExtractor | null}
 */
export function resolveExtractor(activity) {
  return EXTRACTORS.find((ex) => ex.canHandle(activity)) ?? null;
}
