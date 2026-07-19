import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/lib/ -> src/ -> auto/ (package root); the store sits beside the Moodle token
// in .auth/ (gitignored), plaintext. No per-link scraping / no encryption.
const STORE_PATH = path.resolve(__dirname, '../..', '.auth/zoom-passcodes.json');

// A missing or corrupt store is not an error — treat it as "nothing saved yet" so a
// first-ever lookup returns null rather than throwing.
function read() {
  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return {
      courses: data?.courses && typeof data.courses === 'object' ? data.courses : {},
      lectures: data?.lectures && typeof data.lectures === 'object' ? data.lectures : {},
    };
  } catch {
    return { courses: {}, lectures: {} };
  }
}

/**
 * Resolve the passcode for a zoom share. A per-lecture (`course/name`) override wins
 * over the per-course default; null when neither is stored.
 * @returns {string|null}
 */
export function lookup(course, name) {
  const store = read();
  return store.lectures[`${course}/${name}`] ?? store.courses[course] ?? null;
}

/**
 * Persist a passcode. `scope:'course'` sets the per-course default (keyed by course);
 * `scope:'lecture'` sets a per-lecture override (keyed by `course/name`). Read-modify-write.
 * @param {{ course: string, name?: string, passcode: string, scope: 'course'|'lecture' }} args
 */
export function save({ course, name, passcode, scope }) {
  const store = read();
  if (scope === 'lecture') store.lectures[`${course}/${name}`] = passcode;
  else store.courses[course] = passcode;
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store));
}
