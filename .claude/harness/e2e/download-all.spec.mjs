// Downloads → University: "Download all" on hb-dl's lecture section, in both segments it spans — a
// zoom share through its passcode prompt included — lands every reachable row and sums the run up.
import { DATABASE, call, saveSettings } from '../lib/api.mjs';
import { ZOOM_PASSCODE, ZOOM_ROW } from '../lib/env.mjs';
import { expect, reseed, reset, site, test, treeLecture } from './fixtures.mjs';

const COURSE = 'hb-dl';
const SECTION = 'הרצאות';
// The seeded lecture: the YouTube child `הרצאה 1` and the direct link `הקלטה 1` both suggest it.
const SEEDED = 'שיעור 1';
const RECORDING_1 = 'הקלטה 1 — מבוא';

let autoRun;

test.beforeEach(async () => {
  await reseed();
  // A landed video would queue the pipeline under the baseline's AUTO_RUN=full.
  autoRun = (await call(`${DATABASE}/settings`)).body.auto_run;
  await saveSettings({ auto_run: 'off' });
});

test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: autoRun });
});

const videoOf = async (name) => (await treeLecture(COURSE, name))?.files['video.mp4'];

test("a section's Download all lands every reachable recording", async ({ page }) => {
  test.setTimeout(90_000);
  await site({ downloadMs: 500 });
  const seededMtime = (await videoOf(SEEDED)).mtime;

  await page.goto('/downloads');
  await page.locator('.downloads-tabs [role=tab]').first().click();
  const source = page.locator('.source-row').filter({
    has: page.locator('.source-row-name', { hasText: new RegExp(`^${COURSE}$`) }),
  });
  await source.locator('.source-row-actions .btn').click();

  const section = page.locator('.recordings-section').filter({
    has: page.locator('.recordings-section-title', { hasText: new RegExp(`^${SECTION}$`) }),
  });
  const run = section.locator('.recordings-section-run');
  const summary = section.locator('.recordings-section-progress');
  const cards = section.locator('.recording-card');
  const card = (title) =>
    cards.filter({ has: page.locator('.recording-title', { hasText: title }) });

  // Videos: the in-site stream, the YouTube playlist's children and the zoom share.
  await expect(run).toBeDisabled();
  await section.locator('.recording-playlist-toggle').click();
  await expect(run).toHaveText('Download all 4');
  // auto keeps a zoom capture per target name for the session, so a fresh name asks for the
  // passcode again on a rerun against the same stack, as the first download of a session does.
  const zoomName = `שיעור ${100 + (Date.now() % 100_000)}`;
  await card(ZOOM_ROW).locator('.recording-name-input').fill(zoomName);
  const videoNames = await namesOf(cards);
  await run.click();

  const prompt = page.locator('.modal').filter({ has: page.locator('.passcode-input') });
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await prompt.locator('.passcode-input').fill(ZOOM_PASSCODE);
  await prompt.locator('button[type=submit]').click();
  await expect(prompt).toHaveCount(0);

  // The button holds "Downloading…" until the queue ends and every download it started has landed.
  await expect(run).toHaveText(/^Download all/, { timeout: 60_000 });
  await expect(summary).toHaveText('3 downloaded, 1 already there');
  // The bulk run never toasts per item; checked after each run, since a toast closes after 3 s.
  await expect(page.locator('.Toastify__toast')).toHaveCount(0);
  expect((await videoOf(zoomName))?.exists).toBe(true);
  await expectLanded(cards, videoNames);

  // Unknown: the direct links, recording 1 among them, plus the site's failure rows — the syllabus
  // page and /gone/ are unsupported, /deny/ fails, /die/ lands on the downloader's own re-fetch.
  await page.locator('.mode-toggle-btn', { hasText: /^Unknown/ }).click();
  await expect(run).toHaveText('Download all 7');
  await expect(card(RECORDING_1).locator('.recording-name-input')).toHaveValue(SEEDED);
  const unknownNames = await namesOf(cards);
  await run.click();
  await expect(run).toHaveText(/^Downloading/);
  await expect(run).toHaveText(/^Download all/, { timeout: 60_000 });
  await expect(summary).toHaveText('2 downloaded, 1 failed, 2 unsupported, 2 already there');
  await expect(page.locator('.Toastify__toast')).toHaveCount(0);
  await expectLanded(cards, unknownNames);

  // Recording 1 was skipped, not re-downloaded over the seeded video. Its card is not checked: a
  // skipped link is never probed, so it stays "?" unless an earlier probe this session typed it.
  expect((await videoOf(SEEDED)).mtime).toBe(seededMtime);
});

/** Each card's title → the lecture name it was submitted under. */
async function namesOf(cards) {
  const names = {};
  for (const card of await cards.all())
    names[await card.locator('.recording-title').textContent()] = await card
      .locator('.recording-name-input')
      .inputValue();
  return names;
}

/** Every card the row calls downloaded has its lecture's video in the database's tree. */
async function expectLanded(cards, names) {
  for (const card of await cards.all()) {
    if (!/recording-card--downloaded/.test(await card.getAttribute('class'))) continue;
    const name = names[await card.locator('.recording-title').textContent()];
    expect((await videoOf(name))?.exists, name).toBe(true);
  }
}
