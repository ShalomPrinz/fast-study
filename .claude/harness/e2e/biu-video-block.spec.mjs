// BIU's sidebar video block: its recording lists beside the course contents and downloads, from the
// object store with no Moodle call, into the recitation folder its name classifies it as.
import { DATABASE, call, saveSettings } from '../lib/api.mjs';
import { loadRecordings, showRecording } from '../lib/downloads.mjs';
import { expect, reseed, reset, test } from './fixtures.mjs';

const COURSE = 'hb-dl';
// Served by fakes/site.mjs' block list; "תרגול" makes it a recitation.
const BLOCK_VIDEO = 'תרגול 2 - אוהד';

let autoRun;

test.use({ locale: 'en-US' });

test.beforeEach(async () => {
  await reseed();
  autoRun = (await call(`${DATABASE}/settings`)).body.auto_run;
  await saveSettings({ auto_run: 'off' });
});
test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: autoRun });
});

test('a sidebar block video lists and downloads into the recitation folder', async ({ page }) => {
  await loadRecordings(page, COURSE);
  const card = await showRecording(page, BLOCK_VIDEO);
  await card.locator('.recording-download-btn').click();
  await expect(card).toHaveClass(/recording-card--downloaded/, { timeout: 30_000 });
  // The app names a recitation itself ("Recitation 2"); the block's title rides in its video source.
  const { body: tree } = await call(`${DATABASE}/tree`);
  const recitations = tree.find((c) => c.name === COURSE).recitations;
  const made = recitations.find((r) => r.videoSource && atob(r.videoSource).includes('biu-video'));
  expect(made.files['video.mp4'].exists).toBe(true);
});
