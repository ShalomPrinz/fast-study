// Two concerns, matched at different granularities.
// Auth: per university (host). Extractor: per activity (modType). Discovery is the
// stateless Moodle WS API (core_course_get_contents), not a per-LMS DOM parser.
import { MoodleToken } from '../auth/moodleToken.js';
import { VideostreamExtractor } from '../extractors/VideostreamExtractor.js';
import { YoutubePlaylistExtractor } from '../extractors/YoutubePlaylistExtractor.js';
import { ZoomExtractor } from '../extractors/ZoomExtractor.js';

// Universities own AUTH (per host). The one-time headed token grab yields a long-lived
// Moodle WS token; the token authenticates the stateless REST API thereafter.
const UNIVERSITIES = [
  {
    id: 'biu',
    matches: (u) => /(^|\.)biu\.ac\.il$/.test(new URL(u).hostname),
    auth: () => new MoodleToken({ tokenPath: '.auth/biu-token.json' }),
  },
];

// Extractors own the per-activity EXTRACTION mechanism. Ordered; first
// canHandle(activity) wins. `resource`/unknown modTypes match none → skipped.
const EXTRACTORS = [
  new VideostreamExtractor(), // modType 'videostream' → in-site .mp4
  new YoutubePlaylistExtractor(), // modType 'url'      → YouTube playlist (redirect)
  new ZoomExtractor(), // modType 'zoom' (synthetic) → passcode-gated zoom share .mp4
];

/**
 * @param {string} courseUrl
 * @returns {{ id: string, auth: () => import('../auth/AuthProvider.js').AuthProvider }}
 */
export function resolveUniversity(courseUrl) {
  const uni = UNIVERSITIES.find((u) => u.matches(courseUrl));
  if (!uni) throw new Error(`No university/auth handler for ${courseUrl}`);
  return uni;
}

/**
 * The default university for auth endpoints that carry no course URL
 * (/auth/status, /auth/connect). Single-university for now (BIU).
 * @returns {(typeof UNIVERSITIES)[number]}
 */
export function defaultUniversity() {
  return UNIVERSITIES[0];
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
 * handles it — null means skip (e.g. a `resource`/PDF activity).
 * @param {import('../extractors/VideoExtractor.js').Activity} activity
 * @returns {import('../extractors/VideoExtractor.js').VideoExtractor | null}
 */
export function resolveExtractor(activity) {
  return EXTRACTORS.find((ex) => ex.canHandle(activity)) ?? null;
}
