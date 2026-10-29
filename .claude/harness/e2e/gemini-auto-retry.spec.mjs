// A transient Gemini failure on Summarize re-runs itself: the wait shows on /running and on the lecture
// step row, the retry fires and the PDF lands; cancelling leaves the plain error. The shim shortens the
// wait to half a second, so a spec holds the countdown on screen by pausing the page's /status refetches.
import path from 'node:path';
import { BACKEND, json, saveSettings } from '../lib/api.mjs';
import { dismissTour } from '../lib/browser.mjs';
import { test, expect, harness, providers, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-fail';
const LECTURE = 'שיעור 2'; // transcribed, so Summarize is the next step
const MATCH = `${COURSE}/${LECTURE}`;

// A reseed restores a transcribed lecture, which AUTO_RUN=full would run before the spec acts.
test.beforeEach(async () => {
  await saveSettings({ auto_run: 'off' });
  await reseed();
});
test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: 'full' });
});

const shot = (page, name) =>
  page.screenshot({ path: path.join(harness.evidence, `gemini-auto-retry-${name}.png`) });

/** The backend only shows the wait for half a second and the page's refetch can land after it, so
 *  `freeze()` polls /status itself until a retry shows, then every page's /status gets that answer
 *  until `lift()`; the line, its countdown and its button are still the page's own render. */
async function holdRetry(...contexts) {
  let frozen = null;
  const handler = async (route) => {
    if (frozen === null) return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: frozen });
  };
  for (const context of contexts) await context.route((url) => url.pathname === '/status', handler);
  const freeze = async () => {
    const until = Date.now() + 10_000;
    while (frozen === null && Date.now() < until) {
      const { body } = await json(`${BACKEND}/status`, 'GET');
      if (JSON.stringify(body).includes('"retry"')) frozen = JSON.stringify(body);
      else await new Promise((resolve) => setTimeout(resolve, 15));
    }
    if (frozen === null) throw new Error('no retry ever showed in /status');
  };
  const lift = () => {
    frozen = null;
  };
  return { freeze, lift };
}

const open = async (context, url) => {
  const page = await context.newPage();
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
  const hold = await holdRetry(context, second);
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
  // The failure lands within milliseconds of the click, so the watch starts first.
  const frozen = hold.freeze();
  await view.getByRole('button', { name: 'Run Remaining' }).click();

  const inQueue = running.locator('.runner-row .retry-line');
  const onRow = view.locator('.pipeline-row[data-step="summarize"] .retry-line');
  await frozen;
  await Promise.all([inQueue.waitFor(), onRow.waitFor()]);
  await expect(inQueue).toHaveAttribute('data-retry-attempt', '1');
  await expect(inQueue).toHaveAttribute('data-retry-of', '3');
  await expect(inQueue.locator('.retry-line-text')).toContainText(
    /^Retrying in \d+:\d\d \(attempt 1\/3\)$/,
  );
  await expect(onRow.locator('.retry-line-text')).toContainText('(attempt 1/3)');
  await expect(summarize).toHaveAttribute('data-status', 'failed');
  await shot(running, 'running-countdown');
  await shot(lecture, 'lecture-countdown');

  hold.lift();
  await Promise.all([lecture.reload(), running.reload()]); // answers served frozen missed the run's later pushes
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
  // Every call fails, so a cancel that misses one half-second window lands on the next.
  await providers({ gemini: { mode: '503', match: MATCH } });
  const page = await open(context, `/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  const row = view.locator('.pipeline-row[data-step="summarize"]');

  await row.locator('.btn--ghost').click();
  await row.getByRole('button', { name: 'Cancel retry' }).click();

  await expect(row.locator('.retry-line')).toHaveCount(0);
  await expect(row).toHaveAttribute('data-status', 'failed');
  await expect(view.getByTestId('lecture-error')).toContainText(
    'fake gemini is down'.length ? 'Gemini' : '',
  );
  // Past the delay and a few attempts' worth: a retry still armed would have shown its line again.
  await page.waitForTimeout(2_000);
  await expect(row.locator('.retry-line')).toHaveCount(0);
  await expect(row).toHaveAttribute('data-status', 'failed');
  await shot(page, 'cancelled');
});
