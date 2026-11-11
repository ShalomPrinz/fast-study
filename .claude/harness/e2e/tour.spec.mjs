// The first-run tour: a seven-step guided modal over two screenshots, shown once. Every other spec runs with the tour dismissed.
import { expect, reseed, reset, test } from './fixtures.mjs';

test.use({ tourDismissed: false });
test.beforeEach(reseed);
test.afterEach(reset);

const STEPS = 7;
const SLIDE_SWITCH = 3; // index of the first step on the second screenshot
const dialog = (page) => page.locator('.tour-dialog');
const active = (page) => page.locator('.tour-dot.active');

test('the tour shows on first load, walks to Done, and stays gone after a reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  const start = new URL(page.url()).pathname;
  await expect(page.locator('.tour-dot')).toHaveCount(STEPS);
  await expect(page.locator('.tour-slide')).toHaveCount(2);
  await expect(page.locator('.tour-back')).toBeDisabled();

  const slideOf = (i) => (i < SLIDE_SWITCH ? 0 : 1);
  for (let i = 0; i < STEPS - 1; i++) {
    await expect(active(page)).toHaveCount(1);
    await expect(page.locator('.tour-dot').nth(i)).toHaveClass(/active/);
    // The active slide holds the screenshot in view, the callout and the ring; the other is inert.
    await expect(page.locator('.tour-slide').nth(slideOf(i))).toHaveClass(/active/);
    await expect(page.locator('.tour-slide').nth(1 - slideOf(i))).not.toHaveClass(/active/);
    await expect(page.locator('.tour-slide.active .tour-shot')).toBeInViewport();
    await expect(page.locator('.tour-callout-title')).not.toBeEmpty();
    await expect(page.locator('.tour-slide.active .tour-highlight')).toBeVisible();
    await expect(page.locator('.tour-skip')).toBeVisible();
    if (i > 0) await expect(page.locator('.tour-back')).toBeEnabled();
    await page.locator('.tour-next').click();
  }

  // Last step: Skip is gone and Next is Done; Back returns without moving the page.
  await expect(page.locator('.tour-dot').nth(STEPS - 1)).toHaveClass(/active/);
  await expect(page.locator('.tour-skip')).toHaveCount(0);
  await page.locator('.tour-back').click();
  await expect(page.locator('.tour-dot').nth(STEPS - 2)).toHaveClass(/active/);
  await page.locator('.tour-next').click();
  expect(new URL(page.url()).pathname).toBe(start);

  await page.locator('.tour-next').click(); // Done
  await expect(dialog(page)).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(start);

  await page.reload();
  await expect(page.locator('.sidebar-nav-block')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test('Skip counts as seen, and Settings replays the tour from the first step', async ({ page }) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  await page.locator('.tour-skip').click();
  await expect(dialog(page)).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.sidebar-nav-block')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);

  await page.goto('/settings');
  await page.locator('.settings-replay-tour').click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.tour-dot').first()).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings/);
});
