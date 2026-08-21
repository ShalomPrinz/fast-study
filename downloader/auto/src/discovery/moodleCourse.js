/**
 * @typedef {import('../extractors/VideoExtractor.js').Activity} Activity
 */

// Hints (case-insensitive) marking an activity as a recitation, not a lecture.
// (Hebrew: תרגול/תרגיל = recitation; תרגולים contains תרגול so it matches too.)
const RECITATION_KEYWORDS = ['תרגולים', 'תרגול', 'תרגיל', 'recitation', 'tirgul'];

// Hints that a `url` module is a lecture recording rather than a stray course link (syllabus,
// reading, drive folder) — a grouping hint only; see isRecording. (Hebrew: הקלטות/הקלטה = recordings; הרצאות/הרצאה = lectures.)
const RECORDING_KEYWORDS = [
  'הקלטות',
  'הרצאות',
  'הקלטה',
  'הרצאה',
  'recording',
  'lecture',
  ...RECITATION_KEYWORDS,
];

/**
 * Section name / title text ⇒ activity kind. Defaults to 'lecture' when no
 * recitation hint is present (per the course-example guidance).
 * @param {string} sectionName
 * @param {string} title
 * @returns {'lecture'|'recitation'}
 */
export function classifyKind(sectionName, title) {
  const hay = `${sectionName} ${title}`.toLowerCase();
  return RECITATION_KEYWORDS.some((k) => hay.includes(k.toLowerCase())) ? 'recitation' : 'lecture';
}

/**
 * Does this activity's section heading OR title read like a recording? A HINT, never a gate:
 * a keyword is a guess about content made from a title, so every `url` module is listed either
 * way and the frontend only uses a false to group the row under "Other Videos".
 * @param {string} sectionName
 * @param {string} title
 * @returns {boolean}
 */
export function isRecording(sectionName, title) {
  const hay = `${sectionName} ${title}`.toLowerCase();
  return RECORDING_KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
}
