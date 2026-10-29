// The first-run guided tour: seven steps (spotlight or screenshot card); only a ticked "Don't show again"
// stops it returning. Every other spec runs with the tour dismissed.
import { expect, reseed, reset, test } from './fixtures.mjs';

test.use({ tourDismissed: false });
test.beforeEach(reseed);
test.afterEach(reset);

const STEPS = ['sidebar', 'downloads', 'runner', 'lecture', 'editor', 'search', 'drive'];
// No run is live and the editor's lecture exists, so only the runner has no anchor to spotlight.
const CARD = new Set(['runner']);

const dialog = (page) => page.locator('.tour-popover, .tour-card');
const count = (page) => page.locator('.tour-count');

test('the tour walks every step, spotlighting live anchors and carding the missing one', async ({
  page,
}) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.tour-blocker')).toBeVisible();

  for (const [i, id] of STEPS.entries()) {
    await expect(count(page)).toHaveText(`${i + 1} of ${STEPS.length}`, { timeout: 10_000 });
    if (CARD.has(id)) {
      // The anchor is waited for 2.5 s before the card replaces the spotlight.
      await expect(page.locator('.tour-card')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.tour-card .tour-shot')).toBeVisible();
      await expect(page.locator('.tour-popover')).toHaveCount(0);
    } else {
      await expect(page.locator('.tour-popover')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.tour-spot')).toBeVisible();
      await expect(page.locator('.tour-shot')).toHaveCount(0);
    }
    if (i === 0) await expect(page.locator('.tour-back')).toBeDisabled();
    if (i < STEPS.length - 1) await page.locator('.tour-next').click();
  }

  // Back returns one step, route included.
  await page.locator('.tour-back').click();
  await expect(count(page)).toHaveText(`6 of ${STEPS.length}`);
  await expect(page).toHaveURL(/\/search/);
  await expect(page.locator('.tour-popover')).toBeVisible();
  await page.locator('.tour-next').click();
  await page.locator('.tour-next').click(); // Done
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.tour-blocker')).toHaveCount(0);
});

test('Skip and Escape close the tour but a reload brings it back', async ({ page }) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  await page.locator('.tour-skip').click();
  await expect(dialog(page)).toHaveCount(0);

  await page.reload();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  await page.reload();
  await expect(dialog(page)).toBeVisible();
});

test('"Don\'t show again" keeps the tour away, and Settings replays it', async ({ page }) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  await page.locator('.tour-dismiss input').check();
  await page.locator('.tour-skip').click();
  await expect(dialog(page)).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.sidebar-nav-block')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.tour-blocker')).toHaveCount(0);

  await page.goto('/settings');
  await page.locator('.settings-replay-tour').click();
  await expect(dialog(page)).toBeVisible();
  await expect(count(page)).toHaveText(`1 of ${STEPS.length}`);
});

test('Tab stays inside the tour dialog', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tour-popover')).toBeVisible();
  await expect(page.locator('.tour-next')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(
    await page.locator(':focus').evaluate((el) => !!el.closest('.tour-popover, .tour-card')),
  ).toBe(true);
});
