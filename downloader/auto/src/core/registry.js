// Two concerns, matched at different granularities: auth for the one configured Moodle site,
// extraction per activity (modType + target).
import { EventEmitter } from 'node:events';
import { tokenPath, readTokenFile } from '../auth/tokenStore.js';
import { CodedError } from '../lib/errors.js';
import { MoodleToken, storedSiteOf } from '../auth/moodleToken.js';
import { currentSite, setCurrentSite, underSite } from '../moodle/site.js';
import { challengeEvents, closeChallenge } from '../moodle/challenge.js';
import { VideostreamExtractor } from '../extractors/VideostreamExtractor.js';
import { YoutubePlaylistExtractor } from '../extractors/YoutubePlaylistExtractor.js';
import { GoogleDriveExtractor } from '../extractors/GoogleDriveExtractor.js';
import { ZoomExtractor } from '../extractors/ZoomExtractor.js';
import { MoodleFileExtractor } from '../extractors/MoodleFileExtractor.js';
import { DirectUrlExtractor } from '../extractors/DirectUrlExtractor.js';

// One token file whatever the site: the record names its site, and one for another reads as absent.
const TOKEN_PATH = tokenPath;

// The configured site's auth, reused across requests so connect()/complete() share one headed
// browser. Rebuilt when the site changes (setSite); the token file it reads is kept across that.
let cached = null;

// One stream of auth-state changes whichever site is configured; /auth/events subscribes here.
export const authEvents = new EventEmitter();
const publish = () => authEvents.emit('change');

/** The configured site's auth state, or the idle one when no site is set. */
export function authState() {
  const site = currentSite();
  if (!site) {
    const storedSite = storedSiteOf(readTokenFile(TOKEN_PATH()), null);
    return { phase: 'idle', connected: false, expired: false, unverified: false, storedSite };
  }
  return siteAuth().auth.state();
}

// The user solving the window's captcha verifies the token a blocked login left unverified.
challengeEvents.on('solved', (site) => {
  if (cached?.site === site) void cached.auth.verifyAfterSolve();
});

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
    cached = { site, auth: new MoodleToken({ tokenPath: TOKEN_PATH(), site, onChange: publish }) };
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
 * Switch to another site (null clears it), deleting nothing: the stored token reads as absent until
 * its site is set again. The old site's pending login ends, and the challenge window closes so no
 * session cookie carries across. The same site is a no-op.
 * @returns {Promise<boolean>}  whether anything changed
 */
export async function setSite(site) {
  const old = currentSite();
  if ((site || null) === old) return false;
  const auth = cached?.auth;
  cached = null;
  setCurrentSite(site);
  if (auth) await auth.abandonLogin();
  await closeChallenge();
  publish();
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

/** Every registered extractor, in routing order. */
export function extractors() {
  return [...EXTRACTORS];
}

/** Whether acting on a recording reaches Moodle — its own extractor's answer, never a guess here. */
export function reachesMoodle(recording) {
  return resolveExtractorForRecording(recording).reachesMoodle(recording);
}

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
