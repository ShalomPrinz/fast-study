// Three concerns, matched at different granularities.
// Auth: per university (host). Parser: per LMS. Extractor: per activity (modType).
import { MicrosoftAuth } from './auth/MicrosoftAuth.js';
import { parseMoodleCourse } from './extractors/moodleCourse.js';
import { VideostreamExtractor } from './extractors/VideostreamExtractor.js';
import { YoutubePlaylistExtractor } from './extractors/YoutubePlaylistExtractor.js';

// Universities own AUTH (per host) + which LMS parser enumerates their courses.
const UNIVERSITIES = [
  {
    id: 'biu',
    // PLACEHOLDER: adjust to the real BIU course host (see plan §9).
    matches: (u) => /(^|\.)biu\.ac\.il$/.test(new URL(u).hostname),
    auth: () => new MicrosoftAuth({ statePath: '.auth/biu.json' }),
    parse: parseMoodleCourse, // BIU runs Moodle
  },
];

// Extractors own the per-activity EXTRACTION mechanism. Ordered; first
// canHandle(activity) wins. `resource`/unknown modTypes match none → skipped.
const EXTRACTORS = [
  new VideostreamExtractor(), // modType 'videostream' → in-site .mp4
  new YoutubePlaylistExtractor(), // modType 'url'      → YouTube playlist (redirect)
];

/**
 * @param {string} courseUrl
 * @returns {{ id: string, auth: () => import('./auth/AuthProvider.js').AuthProvider,
 *             parse: (page: import('playwright').Page) => Promise<import('./extractors/VideoExtractor.js').Activity[]> }}
 */
export function resolveUniversity(courseUrl) {
  const uni = UNIVERSITIES.find((u) => u.matches(courseUrl));
  if (!uni) throw new Error(`No university/auth handler for ${courseUrl}`);
  return uni;
}

/**
 * Route one activity to its extractor. Returns null (no throw) when no strategy
 * handles it — null means skip (e.g. a `resource`/PDF activity).
 * @param {import('./extractors/VideoExtractor.js').Activity} activity
 * @returns {import('./extractors/VideoExtractor.js').VideoExtractor | null}
 */
export function resolveExtractor(activity) {
  return EXTRACTORS.find((ex) => ex.canHandle(activity)) ?? null;
}
