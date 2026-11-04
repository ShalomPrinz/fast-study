// The service banner under the launcher's bridge (stubbed): a stop shows it, Restart calls the
// launcher once, asking first while a pipeline step runs, and Dismiss hides it until the next stop.
import { BACKEND, call, saveSettings } from '../lib/api.mjs';
import { test, expect, providers, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-fail';
const LECTURE = 'שיעור 2'; // transcribed, so Summarize is the next step

test.use({ launcherBridge: true });
test.beforeEach(async () => {
  await saveSettings({ auto_run: 'off' }); // a reseed's transcribed lecture must not run by itself
  await reseed();
});
test.afterEach(async () => {
  // Releases the held step and waits it out: a manual step shows in `in_flight`, never `runner.running`.
  await providers({ gemini: 'empty' });
  try {
    await expect
      .poll(async () => (await call(`${BACKEND}/status`)).body.in_flight.length, {
        timeout: 120_000,
      })
      .toBe(0);
  } finally {
    await reset();
    await reseed();
    await saveSettings({ auto_run: 'full' });
  }
});

const stop = (page, name = 'backend') => page.evaluate((n) => globalThis.__fsStop(n), name);
const restarts = (page) => page.evaluate(() => globalThis.__fsRestarts.length);

test('a stopped service shows the banner and Restart calls the launcher once', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('alert').filter({ has: page.locator('.service-banner-restart') });
  await expect(banner).toHaveCount(0);
  await stop(page);
  await expect(banner).toBeVisible();
  await banner.locator('.service-banner-restart').click();
  await expect.poll(() => restarts(page)).toBe(1);
  await expect(page.locator('.modal-actions')).toHaveCount(0);
});

test('Restart with a step running asks first: cancel does nothing, confirm restarts', async ({
  page,
}) => {
  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const row = page.locator('.pipeline-row[data-step="summarize"]');
  await providers({ gemini: { mode: 'slow', ms: 60_000, match: `${COURSE}/${LECTURE}` } });
  await row.locator('.btn--ghost').click();
  await expect(row).toHaveAttribute('data-status', 'running');

  await stop(page);
  const restart = page.locator('.service-banner-restart');
  await restart.click();
  await expect(page.locator('.modal-actions')).toBeVisible();
  await page.locator('.modal-actions .btn--ghost').click();
  await expect(page.locator('.modal-actions')).toHaveCount(0);
  expect(await restarts(page)).toBe(0);

  await restart.click();
  await page.locator('.modal-actions .btn--primary').click();
  await expect.poll(() => restarts(page)).toBe(1);
});

test('Dismiss hides the banner and the next stop shows it again', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('alert').filter({ has: page.locator('.service-banner-restart') });
  await stop(page);
  await expect(banner).toBeVisible();
  await banner.locator('.btn--ghost').click();
  await expect(banner).toHaveCount(0);
  await stop(page, 'database');
  await expect(banner).toBeVisible();
  expect(await restarts(page)).toBe(0);
});
