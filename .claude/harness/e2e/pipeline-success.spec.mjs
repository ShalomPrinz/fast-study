// A summarised lecture runs its remaining steps — PDF (real pandoc + tectonic) and Drive (fake) — to
// a finished lecture, judged only by what the lecture view shows.
import { test, expect, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-pipeline';
const LECTURE = 'שיעור 3';

// Back to the seed first, whatever an earlier run left, so the suite reruns on one stack.
test.beforeEach(reseed);
test.afterEach(reset);

test('a summarised lecture runs to a finished PDF uploaded to Drive', async ({ page }) => {
  // Covers both 45 s step waits on a warm tectonic cache; a cold one fetches the LaTeX bundle for minutes.
  test.setTimeout(100_000);

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);

  const step = (name) => view.locator(`[data-testid="step-status"][data-step="${name}"]`);
  await expect(step('summarize')).toHaveAttribute('data-status', 'done');
  // Not done rather than pending: the backend keeps a lecture's last error across a reseed.
  await expect(step('pdf')).not.toHaveAttribute('data-status', 'done');
  await expect(step('drive')).not.toHaveAttribute('data-status', 'done');
  await expect(view.getByTestId('open-pdf')).toHaveCount(0);

  await view.locator('.page-header-actions .btn--primary').click();
  // Past the start first, so a stale `failed` left by an earlier run never reads as this run's end.
  await expect(step('pdf')).toHaveAttribute('data-status', /^(running|done)$/);

  // Wait for each step to settle, then require success, so a failed step fails at once.
  for (const name of ['pdf', 'drive']) {
    await expect(step(name)).toHaveAttribute('data-status', /^(done|failed|quota)$/, {
      timeout: 45_000,
    });
    await expect(step(name)).toHaveAttribute('data-status', 'done', { timeout: 1_000 });
  }
  // The file itself appears in the row with its size, and the header calls the lecture complete.
  await expect(step('pdf').locator('.pipeline-file')).toHaveText(/^summary\.pdf · \S/);
  await expect(view.getByTestId('open-pdf')).toBeVisible();
  await expect(view.locator('.page-header-state--done')).toBeVisible();
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);
});
