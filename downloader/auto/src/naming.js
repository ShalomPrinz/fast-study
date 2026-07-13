import { askUntil } from './prompt.js';

/** kind → app-convention name prefix (matches suggestLectureName in popup.js). */
function prefixFor(kind) {
  return kind === 'recitation' ? 'Recitation' : 'Lecture';
}

/**
 * Derive the app-convention lecture/recitation name from a recording title by
 * pulling the first integer out of it. Returns null when the title has no number
 * (caller should then prompt).
 *   deriveName('הרצאה 1', 'lecture')     -> 'Lecture 1'
 *   deriveName('תרגול 3', 'recitation')  -> 'Recitation 3'
 *   deriveName('רועי', 'recitation')     -> null
 * @param {string} title
 * @param {string} kind  'lecture' | 'recitation'
 * @returns {string|null}
 */
export function deriveName(title, kind) {
  const m = String(title ?? '').match(/\d+/);
  return m ? `${prefixFor(kind)} ${parseInt(m[0], 10)}` : null;
}

/**
 * Append a dotted part suffix to a base name, for a single source that yields two
 * recordings (a zoom share holding a before/after-break pair). The download server
 * accepts dotted folder names (isSafeName only rejects exactly '.'/'..').
 *   splitName('Lecture 8', 1) -> 'Lecture 8.1'
 *   splitName('Lecture 8', 2) -> 'Lecture 8.2'
 * @param {string} baseName
 * @param {number} part
 * @returns {string}
 */
export function splitName(baseName, part) {
  return `${baseName}.${part}`;
}

/**
 * Prompt on the terminal for a lecture/recitation number and build the name.
 * Re-asks until an integer is entered.
 * @param {string} kind  'lecture' | 'recitation'
 * @returns {Promise<string>}
 */
export function promptNumber(kind) {
  const word = kind === 'recitation' ? 'recitation' : 'lecture';
  return askUntil(`Enter ${word} number: `, (answer) => {
    const m = answer.match(/\d+/);
    return m ? `${prefixFor(kind)} ${parseInt(m[0], 10)}` : null;
  });
}
