// Running pipelines → "Run these now" while a downloaded lecture is still running: the lectures not
// yet queued join that live run behind it, and a lecture downloaded after it joins the same run last.
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND, DATABASE, bytes, call, json, saveSettings } from '../lib/api.mjs';
import { FAKE_COURSE_URL } from '../lib/env.mjs';
import { loadRecordings } from '../lib/downloads.mjs';
import { expect, harness, providers, reseed, reset, site, test } from './fixtures.mjs';

// The fake site's course, alone in the empty scratch root so "Run these now" queues only its lectures.
const COURSE = 'hb-run';
// Video-only, so both are pending; named apart from the two downloads' suggested names.
const PENDING = ['שיעור 1', 'שיעור 3'];
// The direct-mp4 recordings list under the Unknown filter, the videostream one under Videos.
const FIRST = { recording: 'הקלטה 4 — גרפים', lecture: 'שיעור 4', filter: 'Videos' };
const SECOND = { recording: 'הקלטה 2 — סיבוכיות', lecture: 'שיעור 2', filter: 'Unknown' };

// The backend's queue survives a reseed, and the seed wipes this root, so wait for the drain first.
async function waitForIdleRunner() {
  await expect
    .poll(async () => (await call(`${BACKEND}/status`)).body.runner.running, { timeout: 120_000 })
    .toBe(false);
}

async function seedCourse() {
  await saveSettings({ data_root: harness.dataEmpty });
  await json(`${DATABASE}/courses`, 'POST', { name: COURSE, source_url: FAKE_COURSE_URL });
  const video = fs.readFileSync(path.join(harness.fixtures, 'video.mp4'));
  for (const lecture of PENDING) {
    const base = `${DATABASE}/courses/${encodeURIComponent(COURSE)}/lectures`;
    await json(`${base}?kind=lecture`, 'POST', { name: lecture });
    await bytes(
      `${base}/${encodeURIComponent(lecture)}/video?kind=lecture`,
      'PUT',
      video,
      'video/mp4',
    );
  }
  await call(`${DATABASE}/notify`, { method: 'POST' });
}

test.beforeEach(async () => {
  await waitForIdleRunner();
  await reseed();
  await seedCourse();
});

test.afterEach(async () => {
  // Lifts the hold, and every lecture left in the run stops at its transcript instead of a real PDF.
  await providers({ groq: 'ok', gemini: 'empty' });
  // Reset and reseeded even when the drain times out, so the stack never stays on the empty root.
  try {
    await waitForIdleRunner();
  } finally {
    await reset();
    await reseed();
  }
});

async function download(page, { recording, lecture, filter }) {
  await loadRecordings(page, COURSE);
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
  test.setTimeout(240_000);
  await site({ downloadMs: 500 });
  // Transcription of the first lecture is held until afterEach lifts it, so it stays the runner's
  // lecture through every check.
  await providers({ groq: { mode: 'slow', ms: 30_000, match: `${COURSE}/${FIRST.lecture}` } });

  const section = (title) =>
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const titles = (title) => section(title).locator('.runner-row .row-title');
  const running = section('Now running').locator('.focus-title');
  // The runner queues a run-all's lectures in the database's folder order, which nothing sorts.
  const asSet = (titles) => expect.poll(async () => (await titles.allTextContents()).sort());

  // The baseline's AUTO_RUN=full starts the downloaded lecture's pipeline.
  await download(page, FIRST);
  await page.goto('/running');
  await expect(running).toHaveText(FIRST.lecture);
  await expect(titles('Queued')).toHaveCount(0);
  await expect(titles('Not queued')).toHaveText(PENDING);

  await section('Not queued').getByRole('button', { name: 'Run these now' }).click();
  await expect(titles('Not queued')).toHaveCount(0);
  await asSet(titles('Queued')).toEqual(PENDING);
  await expect(running).toHaveText(FIRST.lecture);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);

  // A lecture arriving now joins the same run at the back of its queue.
  await download(page, SECOND);
  await page.goto('/running');
  await expect(running).toHaveText(FIRST.lecture);
  await expect(titles('Queued')).toHaveCount(PENDING.length + 1);
  await expect(titles('Queued').last()).toHaveText(SECOND.lecture);
  await asSet(titles('Queued').filter({ hasNotText: SECOND.lecture })).toEqual(PENDING);
  await expect(titles('Not queued')).toHaveCount(0);
});
