// The backend's timing.db as a used install would hold it: realistic samples per operation, so an
// ETA reads seconds to minutes rather than the sub-second runs the fakes leave behind.
import fs from 'node:fs';
import path from 'node:path';

const MB = 1024 * 1024;
// 8 / 12 / 20 s at 1 / 5 / 20 MB, scaled per operation.
const SIZES_MB = [1, 5, 20];
const SECONDS = {
  audio: [8, 12, 20],
  transcribe: [16, 30, 70],
  summarize: [20, 40, 80],
  pdf: [8, 12, 20],
  drive: [6, 8, 12],
  assignment_intuition: [20, 30, 50],
  assignment_solution: [25, 40, 65],
  merge_pdf: [8, 12, 20],
};

/** The rows `[operation, file_size_bytes, duration_seconds]` a reseed writes. */
export function timingSamples() {
  return Object.entries(SECONDS).flatMap(([operation, seconds]) =>
    SIZES_MB.map((mb, i) => [operation, mb * MB, seconds[i]]),
  );
}

/** Replace the timing table's rows in `<state>/timing.db` with `timingSamples()`. */
export async function seedTiming(paths) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(paths.state, { recursive: true });
  const db = new DatabaseSync(path.join(paths.state, 'timing.db'));
  try {
    // The backend's own schema, in case it has not created the file yet.
    db.exec(`CREATE TABLE IF NOT EXISTS timing (
      id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
      duration_seconds REAL NOT NULL, recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    db.exec('DELETE FROM timing');
    const insert = db.prepare(
      'INSERT INTO timing (operation, file_size_bytes, duration_seconds) VALUES (?, ?, ?)',
    );
    for (const row of timingSamples()) insert.run(...row);
  } finally {
    db.close();
  }
}
