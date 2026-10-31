// Downloads → University's New view on a course nothing is filed from: the first-load banner,
// marking a row irrelevant and restoring it from All, then "Download selected" on a subset where
// the dead link is auto-skipped.
import { exactly, pickCourse, recordingCard, showRecording } from '../lib/downloads.mjs';
import { FAILURE_ROWS } from '../lib/env.mjs';
import { restart } from '../lib/stack.mjs';
import { expect, harness, reseed, reset, site, test } from './fixtures.mjs';

const COURSE = 'hb-dl-fresh';
const KEEP = 'הקלטה 2 — סיבוכיות';
// Plain direct-mp4 rows; the zoom row (passcode pause) and the colliding suggested names stay out.
const SUBSET = ['הקלטה 1 — מבוא', 'הקלטה 3 — עצים', FAILURE_ROWS.gone];

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

test.beforeEach(async () => {
  await reseed();
  // auto's probe cache and the server's last course run both remember the dead link as unsupported,
  // which would pre-decide its row on the next load and skip the run-time auto-skip.
  await restart(harness, 'downloader-auto', {});
  await restart(harness, 'downloader-server', {});
});

test.afterEach(async () => {
  await reset();
});

const scope = (page, name) =>
  page.locator('.downloads-scope-switch .mode-toggle-btn', { hasText: exactly(name) });
const newRow = (page, title) =>
  page.locator('.new-row').filter({ has: page.locator('.recording-title', { hasText: title }) });

/** Load the course as Downloads does, leaving the list on its default New scope. */
async function loadNew(page) {
  await pickCourse(page, COURSE);
  await expect(page.locator('.new-view')).toBeVisible();
}

/** Tick exactly the rows titled `titles`; every other row of the New view is unticked. */
async function selectOnly(page, titles) {
  for (const box of await page.locator('.new-row-check').all()) {
    const label = (await box.getAttribute('aria-label')) ?? '';
    await box.setChecked(titles.some((t) => label.includes(t)));
  }
}

test('mark a row irrelevant, restore it, then download a subset with the dead link auto-skipped', async ({
  page,
}) => {
  await loadNew(page);

  // First load: the banner offers one action.
  const banner = page.locator('.new-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button')).toHaveText(['Skip all']);
  await expect(newRow(page, KEEP)).toBeVisible();

  // Mark one row irrelevant: it leaves New, shows Skipped in All, and the banner goes.
  await selectOnly(page, [KEEP]);
  await page.getByRole('button', { name: 'Mark selected as irrelevant' }).click();
  await expect(newRow(page, KEEP)).toHaveCount(0);
  await expect(banner).toHaveCount(0);
  await scope(page, 'All').click();
  const card = await showRecording(page, KEEP);
  await expect(card.locator('.skipped-chip')).toHaveText('Skipped');

  // Restore it from All: it is back in New.
  await card.locator('.skipped-restore').click();
  await expect(card.locator('.skipped-chip')).toHaveCount(0);
  await scope(page, 'New').click();
  await expect(newRow(page, KEEP)).toBeVisible();

  // Download a subset slowly: a row shows its downloading state, the good ones land, the dead one is skipped.
  await site({ downloadMs: 4000 });
  await selectOnly(page, SUBSET);
  await page.getByRole('button', { name: 'Download selected (3)' }).click();
  await expect(page.locator('.new-row .recording-card--downloading').first()).toBeVisible({
    timeout: 20_000,
  });
  for (const title of SUBSET) await expect(newRow(page, title)).toHaveCount(0, { timeout: 60_000 });
  await expect(newRow(page, KEEP)).toBeVisible();

  await scope(page, 'All').click();
  await expect((await showRecording(page, FAILURE_ROWS.gone)).locator('.skipped-chip')).toHaveText(
    'Skipped',
  );
  for (const title of SUBSET.slice(0, 2)) {
    await expect(recordingCard(page, title)).toHaveClass(/recording-card--downloaded/);
  }
});
