// A transient Gemini failure on Summarize re-runs itself: the wait shows on /running and on the lecture
// step row, the retry fires and the PDF lands; cancelling leaves the plain error. The shim holds the
// backend's retry timers, so the spec fires them itself and pins the pages' clock for the countdown.
import path from 'node:path';
import { BACKEND, fireRetries, json, saveSettings } from '../lib/api.mjs';
import { dismissTour } from '../lib/browser.mjs';
import { test, expect, harness, providerHits, providers, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-fail';
const LECTURE = 'שיעור 2'; // transcribed, so Summarize is the next step
const MATCH = `${COURSE}/${LECTURE}`;

// A reseed restores a transcribed lecture, which AUTO_RUN=full would run before the spec acts.
// Model fallback is off: on, it would absorb a single 503 and no retry would arm.
test.beforeEach(async () => {
  await saveSettings({ auto_run: 'off', gemini_auto_fallback: false });
  await reseed();
});
test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: 'full', gemini_auto_fallback: true });
});

const shot = (page, name) =>
  page.screenshot({ path: path.join(harness.evidence, `gemini-auto-retry-${name}.png`) });

/** The held retry's `at` from /status, once the failed step has armed it. */
async function retryAt() {
  let at = null;
  await expect
    .poll(async () => {
      const { body } = await json(`${BACKEND}/status`, 'GET');
      at = Object.values(body.errors ?? {}).find((error) => error.retry)?.retry.at ?? null;
      return at;
    })
    .not.toBeNull();
  return new Date(at).getTime();
}

const open = async (context, url) => {
  const page = await context.newPage();
  await page.clock.install(); // pinned later, once the retry's `at` is known
  await page.goto(url);
  return page;
};

test('a transient Gemini failure retries by itself and the PDF lands', async ({
  browser,
  baseURL,
  context,
}) => {
  test.setTimeout(100_000);
  // Its own window: a second tab of one window is hidden, and a hidden page stops painting.
  const second = await browser.newContext({ baseURL, viewport: { width: 1400, height: 900 } });
  await second.addInitScript(dismissTour);
  const lecture = await open(
    context,
    `/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`,
  );
  const running = await open(second, '/running');
  const view = lecture.getByTestId('lecture-view');
  const summarize = view.locator('[data-step="summarize"]');

  // A reseed's file changes reach an open page by push; Run is only the primary action once they have.
  await expect(view.locator('.page-header-state--done')).toHaveCount(0);
  await expect(summarize).not.toHaveAttribute('data-status', 'done');
  await providers({ gemini: { mode: '503', match: MATCH, times: 1 } });
  await view.getByRole('button', { name: 'Run Remaining' }).click();

  const inQueue = running.locator('.runner-row .retry-line');
  const onRow = view.locator('.pipeline-row[data-step="summarize"] .retry-line');
  // Two minutes five seconds before the retry is due, on both pages.
  const at = await retryAt();
  await Promise.all([lecture, running].map((page) => page.clock.setFixedTime(at - 125_000)));
  await expect(inQueue).toHaveAttribute('data-retry-attempt', '1');
  await expect(inQueue).toHaveAttribute('data-retry-of', '3');
  await expect(inQueue.locator('.retry-line-text')).toHaveText('Retrying in 2:05 (attempt 1/3)');
  await expect(onRow.locator('.retry-line-text')).toHaveText('Retrying in 2:05 (attempt 1/3)');
  await expect(summarize).toHaveAttribute('data-status', 'failed');
  await shot(running, 'running-countdown');
  await shot(lecture, 'lecture-countdown');

  expect(await fireRetries()).toEqual([`${MATCH}/lecture`]);
  // A finished lecture folds its step rows into the "Summary ready" card, so completion is the header.
  await expect(view.locator('.page-header-state--done')).toBeVisible({ timeout: 60_000 });
  await expect(onRow).toHaveCount(0);
  await expect(inQueue).toHaveCount(0);
  await expect(view.getByTestId('open-pdf')).toBeVisible();
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);
  await shot(lecture, 'retry-succeeded');
  await second.close();
});

test('cancelling a waiting retry leaves the plain error and nothing re-runs', async ({
  context,
}) => {
  // Every call fails, so a retry that cancel left armed would show as one more Gemini hit.
  await providers({ gemini: { mode: '503', match: MATCH } });
  const page = await open(context, `/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  const row = view.locator('.pipeline-row[data-step="summarize"]');

  await row.locator('.btn--ghost').click();
  await row.getByRole('button', { name: 'Cancel retry' }).click();

  await expect(row.locator('.retry-line')).toHaveCount(0);
  await expect(row).toHaveAttribute('data-status', 'failed');
  await expect(view.getByTestId('lecture-error')).toContainText('Gemini');
  const before = await providerHits();
  expect(await fireRetries()).toEqual([]);
  // A retry that fired anyway would need a moment to reach the fake and to show its line again.
  await expect(row.locator('.retry-line')).toHaveCount(0);
  expect(await providerHits()).toEqual(before);
  await expect(row).toHaveAttribute('data-status', 'failed');
  await shot(page, 'cancelled');
});
