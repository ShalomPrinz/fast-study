// A lecture made only of course PDFs attached from Downloads skips video, audio and transcript, stays
// out of the automatic queue, and runs by hand from its materials to a finished lecture on Drive.
import { DATABASE, call, saveSettings } from '../lib/api.mjs';
import { test, expect, expectStepsDone, reseed, reset, treeLecture } from './fixtures.mjs';

const COURSE = 'hb-dl';
const SECTION = 'חומרי עזר';
// The fake site's two-file resource `דפי תרגול`: Downloads lists one material row per file.
const FILES = ['tirgul-01.pdf', 'tirgul-02.pdf'];
const LECTURE = 'שיעור 7';

const materials = async () =>
  (
    await call(
      `${DATABASE}/courses/${encodeURIComponent(COURSE)}/lectures/${encodeURIComponent(LECTURE)}/materials?kind=lecture`,
    )
  ).body.materials.map((m) => m.name);

test.use({ locale: 'en-US' });
// The seed has no `שיעור 7`, so the reseed also removes the lecture an earlier run made.
test.beforeEach(async () => {
  await reseed();
  await saveSettings({ auto_run: 'off' });
});
test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: 'full' });
});

test('course PDFs attached to a new lecture summarise on their own to Drive', async ({ page }) => {
  test.setTimeout(150_000);

  await page.goto('/downloads');
  await page.locator('.downloads-tabs [role=tab]').first().click();
  const source = page.locator('.source-row').filter({
    has: page.locator('.source-row-name', { hasText: new RegExp(`^${COURSE}$`) }),
  });
  await source.locator('.source-row-actions .btn').click();
  await page.locator('.recordings-panel .mode-toggle-btn', { hasText: 'Materials' }).click();

  const section = page.locator('.recordings-section').filter({
    has: page.locator('.recordings-section-title', { hasText: SECTION }),
  });
  const card = (file) =>
    section.locator('.recording-card').filter({
      has: page.locator('.recording-title', { hasText: file }),
    });
  for (const file of FILES) {
    // `תרגול` in the title makes the row default to Recitation.
    await card(file).locator('.mode-toggle-btn', { hasText: 'Lecture' }).click();
    await card(file).getByLabel('Attach material to').fill(LECTURE);
  }

  await card(FILES[0]).locator('.recording-download-btn').click();
  await expect(card(FILES[0]).locator('.recording-material-count')).toHaveText('1 material', {
    timeout: 15_000,
  });
  // A material row reads "In course" once its target holds any material, so the second file goes in
  // through the row's own re-download, which appends rather than replaces.
  await card(FILES[1]).getByLabel('Download again').click();
  await expect(card(FILES[1]).locator('.recording-material-count')).toHaveText('2 materials', {
    timeout: 15_000,
  });

  expect(await materials()).toEqual(['material.pdf', 'material.2.pdf']);
  expect((await treeLecture(COURSE, LECTURE)).files['video.mp4'].exists).toBe(false);

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  const row = (file) =>
    view
      .locator('.pipeline-row')
      .filter({ has: page.locator('.pipeline-file', { hasText: file }) });
  for (const file of ['video.mp4', 'audio.mp3', 'transcript.txt']) {
    await expect(row(file).locator('.pipeline-skipped')).toBeVisible();
    await expect(row(file).locator('button')).toHaveCount(0);
  }

  // Materials-only runs are manual only, so the lecture is not offered as work left.
  await page.goto('/running');
  const notQueued = page.locator('section').filter({
    has: page.locator('.section-title', { hasText: 'Not queued' }),
  });
  await expect(notQueued).toBeVisible();
  const runnerRow = (lecture) =>
    notQueued
      .locator('.runner-row')
      .filter({ has: page.locator('.row-course', { hasText: new RegExp(`^${COURSE}$`) }) })
      .filter({ has: page.locator('.row-title', { hasText: new RegExp(`^${lecture}$`) }) });
  // hb-dl's seeded video-only `שיעור 1` is listed, so the list has loaded before the absence check.
  await expect(runnerRow('שיעור 1')).toHaveCount(1);
  await expect(runnerRow(LECTURE)).toHaveCount(0);

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  await view.locator('.page-header-actions .btn--primary').click();
  await expectStepsDone(view, ['summarize', 'pdf', 'drive']);
  await expect(view.locator('.pipeline-materials-note')).toBeVisible();
  await expect(view.locator('.page-header-state--done')).toBeVisible();
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);
  for (const file of ['audio.mp3', 'transcript.txt'])
    await expect(row(file).locator('.pipeline-skipped')).toBeVisible();

  const { files } = await treeLecture(COURSE, LECTURE);
  for (const name of ['video.mp4', 'audio.mp3', 'transcript.txt'])
    expect(files[name].exists, name).toBe(false);
  for (const name of ['summary.md', 'summary.pdf', 'drive_url.txt'])
    expect(files[name].exists, name).toBe(true);
});
