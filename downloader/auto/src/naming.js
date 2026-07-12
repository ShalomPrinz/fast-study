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
