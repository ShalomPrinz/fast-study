// A summarised lecture runs its remaining steps — PDF (real pandoc + tectonic) and Drive (fake) — to
// a finished lecture, judged only by what the lecture view shows.
import { test, expect, expectRunComplete, reseed, reset, step as stepOf } from './fixtures.mjs';

const COURSE = 'hb-pipeline';
const LECTURE = 'שיעור 3';

// Back to the seed first, whatever an earlier run left, so the suite reruns on one stack.
test.beforeEach(reseed);
test.afterEach(reset);

test('a summarised lecture runs to a finished PDF uploaded to Drive', async ({ page }) => {
  // One 90 s wait for the whole run on a warm tectonic cache; a cold one fetches the LaTeX bundle for minutes.
  test.setTimeout(110_000);

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);

  const step = (name) => stepOf(view, name);
  await expect(step('summarize')).toHaveAttribute('data-status', 'done');
  // Not done rather than pending: the backend keeps a lecture's last error across a reseed.
  await expect(step('pdf')).not.toHaveAttribute('data-status', 'done');
  await expect(step('drive')).not.toHaveAttribute('data-status', 'done');
  await expect(view.getByTestId('open-pdf')).toHaveCount(0);

  await view.locator('.page-header-actions .btn--primary').click();
  // Past the start first, so a stale `failed` left by an earlier run never reads as this run's end.
  await expect(step('pdf')).toHaveAttribute('data-status', /^(running|done)$/);

  await expectRunComplete(view, 90_000);
  // The header calls the lecture complete.
  await expect(view.getByTestId('open-pdf')).toBeVisible();
  await expect(view.locator('.page-header-state--done')).toBeVisible();
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);
});
