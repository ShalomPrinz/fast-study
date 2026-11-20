// Switching courses on Downloads → University: the new course's skeleton while discovery is pending,
// and an inline coded error with Try again when it fails; the old course's rows never linger.
import { loadRecordings, exactly } from '../lib/downloads.mjs';
import { test, expect, reset, site } from './fixtures.mjs';

const A = 'hb-dl';
const B = 'hb-dl-fresh';

test.use({ locale: 'en-US' });
test.afterEach(reset);

// Picks `course` in the combobox without reloading the page.
async function switchTo(page, course) {
  await page.locator('#course-source').click();
  await page.getByRole('option', { name: exactly(course) }).click();
}

test('the new course shows a skeleton and a loadbar until its recordings arrive', async ({
  page,
}) => {
  await loadRecordings(page, A);
  const cards = page.locator('.recording-card');
  await expect(cards.first()).toBeVisible();

  await site({ hold: true });
  await switchTo(page, B);

  await expect(cards).toHaveCount(0);
  await expect(page.locator('.section-head').first()).toContainText(`Recordings · ${B}`);
  await expect(page.locator('.section-count')).toHaveCount(0);
  const skeleton = page.locator('.recordings-panel[aria-busy="true"]');
  await expect(skeleton.locator('.sk-row')).toHaveCount(5);
  await expect(page.locator('.page-header-loadbar')).toBeVisible();

  await site({ hold: false });
  await expect(cards.first()).toBeVisible();
  await expect(page.locator('.recordings-panel[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('.page-header-loadbar')).toHaveCount(0);
});

test('a coded failure stays on the new course with an inline error and Try again', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loadRecordings(page, A);
  await expect(page.locator('.recording-card').first()).toBeVisible();

  await site({ fault: { match: 'core_course_get_contents', status: 500 } });
  await switchTo(page, B);

  const error = page.locator('.recordings-error[role=alert]');
  await expect(error).toBeVisible();
  await expect(error.locator('.recordings-error-headline')).toContainText(
    `Couldn't load recordings for "${B}"`,
  );
  await expect(error.locator('.recordings-error-detail')).toContainText('HTTP 500');
  await expect(page.locator('#course-source')).toHaveValue(B);
  await expect(page.locator('.recording-card')).toHaveCount(0);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);

  await site({ clearFaults: true });
  // Disabled while Moodle reads busy (the failed call's cooldown); the free push enables it.
  const retry = error.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.locator('.recording-card').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.recordings-error')).toHaveCount(0);
  await expect(page.locator('#course-source')).toHaveValue(B);
});
