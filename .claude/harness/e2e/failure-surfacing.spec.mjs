// A provider failure on a pipeline step reaches the lecture page as its translated headline, and the
// step's glyph says which kind: a daily quota, then a plain failure.
import { test, expect, providers, reset } from './fixtures.mjs';

const COURSE = 'hb-fail';
const LECTURE = 'שיעור 2'; // transcribed, so Summarize is the next step and needs no tectonic
const MATCH = `${COURSE}/${LECTURE}`;

test.afterEach(reset);

test('a Gemini failure on Summarize shows its headline and the step reads failed', async ({
  page,
}) => {
  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const row = page.locator('.pipeline-row[data-step="summarize"]');
  const run = row.locator('.btn--ghost');
  const lastError = page.locator('.lecture-error');

  // Quota first: a later run's error replaces an earlier one, so each phase proves a fresh outcome
  // even when a previous run of this spec left the lecture failed.
  await providers({ gemini: { mode: '429', match: MATCH } });
  await run.click();
  await expect(row).toHaveAttribute('data-status', 'quota');
  await expect(lastError).toContainText("Gemini's daily quota is used up.");

  await providers({ gemini: { mode: '500', match: MATCH } });
  await run.click();
  await expect(row).toHaveAttribute('data-status', 'failed');
  await expect(lastError).toContainText('Summarizing the transcript failed.');
  await expect(lastError).toContainText('fake gemini is down'); // the provider's text, verbatim
  await expect(lastError).not.toContainText('quota');
  await expect(row.getByRole('status')).toHaveAttribute(
    'aria-label',
    /^Summarizing the transcript failed\./,
  );
});
