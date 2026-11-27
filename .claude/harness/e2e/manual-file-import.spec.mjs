// Downloads → Manual → "File from computer" in a plain browser: a chosen .mp4 is Copied by an upload
// into a new lecture (Move needs the desktop app), and a dropped non-.mp4 is refused with a toast.
import fs from 'node:fs';
import { lectureFile, saveSettings } from '../lib/api.mjs';
import { test, expect, dropFile, harness, reseed, reset } from './fixtures.mjs';

const VIDEO = `${harness.fixtures}/video.mp4`;
const COURSE = 'hb-mgmt';
const LECTURE = 'הרצאה מיובאת';

test.use({ locale: 'en-US' });
test.beforeEach(async ({ page }) => {
  await reseed();
  // A saved video would queue the pipeline under the default auto-run; the import is the subject here.
  await saveSettings({ auto_run: 'off' });
  await page.goto('/downloads');
  await page.locator('.downloads-tabs [role=tab]').nth(2).click();
  await page.getByRole('button', { name: 'File from computer' }).click();
});
test.afterEach(async () => {
  await saveSettings({ auto_run: 'full' });
  await reset();
});

test('a chosen .mp4 is copied by upload; Move is off without the desktop app', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles(VIDEO);
  const line = page.locator('.manual-download-file');
  await expect(line.locator('.manual-download-file-name')).toHaveText('video.mp4');
  await expect(line.locator('.manual-download-file-size')).toContainText('KB');
  await expect(line.getByRole('button', { name: 'Change' })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Remove file' })).toBeVisible();

  const move = page.getByRole('button', { name: 'Move', exact: true });
  await expect(move).toBeDisabled();
  await move.hover({ force: true });
  await expect(
    page.getByRole('tooltip').filter({ hasText: 'Moving needs the desktop app' }),
  ).toBeVisible();

  // Course and name are the link form's: pick an existing course, name a new lecture.
  await page.locator('.manual-download-course input').click();
  await page.getByRole('option', { name: COURSE, exact: true }).click();
  await page.locator('.manual-download-name input').fill(LECTURE);

  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const card = page.locator('.recording-card').filter({ hasText: LECTURE });
  await expect(card.locator('.chip--ok')).toHaveText('Imported ✓', { timeout: 30_000 });

  const response = await fetch(lectureFile(COURSE, LECTURE, 'video.mp4'));
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(VIDEO))).toBe(true);
});

test('a dropped non-.mp4 toasts and chooses nothing', async ({ page }) => {
  await dropFile(
    page.locator('.manual-download'),
    `${harness.fixtures}/handout.pdf`,
    'application/pdf',
  );
  await expect(
    page.locator('.Toastify__toast--error', { hasText: 'Only .mp4 files are allowed' }),
  ).toBeVisible();
  await expect(page.locator('.manual-download-file')).toHaveCount(0);
  await expect(page.getByText('Drop an .mp4 here')).toBeVisible();

  // The same drop with an .mp4 is taken.
  await dropFile(page.locator('.manual-download'), VIDEO, 'video/mp4');
  await expect(page.locator('.manual-download-file-name')).toHaveText('video.mp4');
});
