// Running pipelines → "Run these now" while a downloaded lecture is still running: the lectures not
// yet queued join that live run, and a lecture downloaded after it joins the same run.
import { BACKEND, call } from '../lib/api.mjs';
import { expect, providers, reseed, reset, site, test } from './fixtures.mjs';

const COURSE = 'hb-dl';
// The rows suggest these names, and hb-dl's seed has neither on disk; the direct-mp4 recordings list
// under the Unknown filter, the videostream one under Videos.
const FIRST = { recording: 'הקלטה 4 — גרפים', lecture: 'שיעור 4', filter: 'Videos' };
const SECOND = { recording: 'הקלטה 2 — סיבוכיות', lecture: 'שיעור 2', filter: 'Unknown' };

// "Run these now" queues every seeded pending lecture, and the backend's queue survives a reseed,
// so the stack is only handed back once the runner has drained.
async function waitForIdleRunner() {
  await expect
    .poll(async () => (await call(`${BACKEND}/status`)).body.runner.running, { timeout: 240_000 })
    .toBe(false);
}

test.beforeEach(async () => {
  await waitForIdleRunner();
  await reseed();
});

test.afterEach(async () => {
  await reset();
  await waitForIdleRunner();
  await reseed();
});

async function download(page, { recording, lecture, filter }) {
  await page.goto('/downloads');
  await page.locator('.downloads-tabs [role=tab]').first().click();
  const source = page.locator('.source-row').filter({
    has: page.locator('.source-row-name', { hasText: new RegExp(`^${COURSE}$`) }),
  });
  await source.locator('.source-row-actions .btn').click();
  await page.locator('.mode-toggle-btn', { hasText: new RegExp(`^${filter}`) }).click();
  const card = page.locator('.recording-card').filter({
    has: page.locator('.recording-title', { hasText: recording }),
  });
  await expect(card.locator('.recording-name-input')).toHaveValue(lecture);
  await card.locator('.recording-download-btn').click();
  await expect(card).toHaveClass(/recording-card--downloaded/, { timeout: 15_000 });
}

test('"Run these now" during a live run queues the rest, and a later download joins it', async ({
  page,
}) => {
  // Mostly the two waits for the runner to drain every seeded pending lecture.
  test.setTimeout(600_000);
  await site({ downloadMs: 500 });
  // Transcription of the first lecture is held, so it is still running through every step below.
  await providers({ groq: { mode: 'slow', ms: 30_000, match: `${COURSE}/${FIRST.lecture}` } });

  // The baseline's AUTO_RUN=full starts the downloaded lecture's pipeline.
  await download(page, FIRST);
  await page.goto('/running');
  const section = (title) =>
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const row = (title, lecture) =>
    section(title)
      .locator('.runner-row')
      .filter({ has: page.locator('.row-course', { hasText: COURSE }) })
      .filter({ has: page.locator('.row-title', { hasText: new RegExp(`^${lecture}$`) }) });

  await expect(section('Now running').locator('.focus-title')).toHaveText(FIRST.lecture);
  const notQueued = section('Not queued').locator('.runner-row');
  await expect(notQueued.first()).toBeVisible();

  await section('Not queued').getByRole('button', { name: 'Run these now' }).click();
  await expect(notQueued).toHaveCount(0);
  await expect(section('Queued').locator('.runner-row').first()).toBeVisible();
  await expect(section('Now running').locator('.focus-title')).toHaveText(FIRST.lecture);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);

  // A lecture arriving now joins the same run: in flight or queued behind the rest.
  await download(page, SECOND);
  await page.goto('/running');
  await expect(
    row('Queued', SECOND.lecture)
      .or(row('Now running', SECOND.lecture))
      .or(section('Now running').locator('.focus-card', { hasText: SECOND.lecture })),
  ).toBeVisible();
  await expect(row('Not queued', SECOND.lecture)).toHaveCount(0);
});
