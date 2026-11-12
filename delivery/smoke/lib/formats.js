import fs from 'node:fs';
import path from 'node:path';
import * as paths from './paths.js';

/** latex/formats/ as sorted names, sizes and mtimes: a render that builds or rewrites a .fmt changes it. */
export function formatsSnapshot() {
  const dir = paths.formatsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => {
      const { size, mtimeMs } = fs.statSync(path.join(dir, name));
      return { name, size, mtimeMs };
    });
}

// The candidate's formats/ as installed, before any render; the update must land the same files.
export let shippedFormats = [];

/** Take the snapshot `shippedFormats` holds; importers read it as a live binding and cannot assign it. */
export function recordShippedFormats() {
  shippedFormats = formatsSnapshot();
}
