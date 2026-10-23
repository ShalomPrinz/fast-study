// Downloads → University: load hb-dl's recordings off the fake site, download one not yet on disk,
// and see it land as that lecture's video — on the row, and on the lecture's own page.
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE, call, saveSettings } from '../lib/api.mjs';
import { removeLecture } from '../lib/baseline.mjs';
import { loadRecordings, recordingCard } from '../lib/downloads.mjs';
import { expect, reset, site, test } from './fixtures.mjs';

const COURSE = 'hb-dl';
// The fake site's videostream activity, listed under Videos; its number makes the row suggest `שיעור 4`.
const RECORDING = 'הקלטה 4 — גרפים';
const LECTURE = 'שיעור 4';

// The download is the only writer of this lecture, so deleting it puts hb-dl back on its seed and
// a rerun on the same stack finds the row not downloaded again.
async function dropLecture() {
  const root = (await call(`${DATABASE}/settings`)).body.data_root;
  if (fs.existsSync(path.join(root, COURSE, LECTURE))) await removeLecture(COURSE, LECTURE);
}

let autoRun;

test.beforeEach(async () => {
  await dropLecture();
  // A landed video queues the pipeline under the baseline's AUTO_RUN=full; the lecture is deleted
  // after the test, so nothing may be running on it then.
  autoRun = (await call(`${DATABASE}/settings`)).body.auto_run;
  await saveSettings({ auto_run: 'off' });
});

test.afterEach(async () => {
  await reset();
  await dropLecture();
  await saveSettings({ auto_run: autoRun });
});

test('a recording downloaded from the course site lands as a lecture video', async ({ page }) => {
  await site({ downloadMs: 500 });
  await loadRecordings(page, COURSE);
  const card = recordingCard(page, RECORDING);
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/recording-card--downloaded/);
  await expect(card.locator('.recording-name-input')).toHaveValue(LECTURE);
  await card.locator('.recording-download-btn').click();

  // The row flips off the live course tree, so this is the video on disk under that lecture.
  await expect(card).toHaveClass(/recording-card--downloaded/, { timeout: 15_000 });
  await expect(card.locator('.chip--ok')).toBeVisible();

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  await expect(view.locator('.pipeline-row').first().locator('.pipeline-stage')).not.toHaveClass(
    /pipeline-stage--pending/,
  );
});
