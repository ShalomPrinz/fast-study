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
