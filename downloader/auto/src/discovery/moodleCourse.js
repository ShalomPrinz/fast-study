/**
 * @typedef {import('../extractors/VideoExtractor.js').Activity} Activity
 */

// Hints (case-insensitive) marking an activity as a recitation, not a lecture.
// (Hebrew: תרגול/תרגיל = recitation; תרגולים contains תרגול so it matches too.)
const RECITATION_KEYWORDS = ['תרגולים', 'תרגול', 'תרגיל', 'recitation', 'tirgul'];

// Hints that a `url` module is a recording playlist, not an unrelated link (syllabus,
// reading, drive folder). (Hebrew: הקלטות/הקלטה = recordings; הרצאות/הרצאה = lectures.)
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
 * Does this activity's section heading OR title mark it as a recording?
 * @param {string} sectionName
 * @param {string} title
 * @returns {boolean}
 */
// Allow-list gating which `url` modules are treated as recordings — considers the
// owning section heading AND the activity's own title.
export function isRecording(sectionName, title) {
  const hay = `${sectionName} ${title}`.toLowerCase();
  return RECORDING_KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
}
