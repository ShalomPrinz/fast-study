// Study progress → lectures marked done from their pages: the tree's marks, the current-item arrow at
// the first gap and the header counts follow, the overview's buttons open the gap or say the track is
// done, a revert walks it all back, and a running lecture's mark gives way to a spinner.
import { BACKEND, call } from '../lib/api.mjs';
import { test, expect, providers, reseed, reset, step } from './fixtures.mjs';

const COURSE = 'hb-pipeline';
const RECITATION = 'תרגול 1';
// Six seeded lectures; marking 1 and 3 leaves 2 as the track's first not-done item.
const LECTURES = 6;
// Video-only, so its run reaches transcription, where the held Groq call keeps it in flight.
const RUNNING = 'שיעור 4';

// The backend's queue survives a reseed, so a run started here drains before the next test reseeds.
async function waitForIdleRunner() {
  await expect
    .poll(async () => (await call(`${BACKEND}/status`)).body.runner.running, { timeout: 120_000 })
    .toBe(false);
}

test.beforeEach(reseed);
test.afterEach(async () => {
  // Lifts the hold, and the run stops at its transcript instead of making a real PDF.
  await providers({ groq: 'ok', gemini: 'empty' });
  try {
    await waitForIdleRunner();
  } finally {
    await reset();
    await reseed();
  }
});

const lecturePath = (name, kind = 'lecture') =>
  `/${encodeURIComponent(COURSE)}/${encodeURIComponent(name)}${kind === 'recitation' ? '?kind=recitation' : ''}`;

test('lectures marked done move the current arrow, the counts and the overview buttons', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const view = page.getByTestId('lecture-view');
  const doneButton = view.locator('button[aria-pressed]');
  const group = page.locator('.course-group').filter({
    has: page.locator('.course-header .course-name', { hasText: new RegExp(`^${COURSE}$`) }),
  });
  const row = (name, kind = 'lecture') =>
    group.locator(`[data-testid="lecture"][data-lecture="${name}"][data-kind="${kind}"]`);
  const mark = (name, kind) => row(name, kind).locator('.lecture-mark');
  const lectureCount = group.locator('.course-header .course-count');
  const recitationCount = group.locator('.recitations-header .course-count');

  async function toggleDone(name, kind, to) {
    await expect(view).toHaveAttribute('data-lecture', name);
    await expect(doneButton).toHaveAttribute('aria-pressed', String(!to));
    await doneButton.click();
    await expect(doneButton).toHaveAttribute('aria-pressed', String(to));
    await expect(doneButton).toHaveClass(to ? /btn--success/ : /btn--info/);
  }

  await page.goto(lecturePath('שיעור 1'));
  await expect(mark('שיעור 1')).toHaveClass(/lecture-mark--current/);
  await expect(lectureCount).toHaveText(`0/${LECTURES}`);
  await toggleDone('שיעור 1', 'lecture', true);
  await row('שיעור 3').click();
  await toggleDone('שיעור 3', 'lecture', true);

  await expect(mark('שיעור 1')).toHaveClass(/lecture-mark--done/);
  await expect(mark('שיעור 3')).toHaveClass(/lecture-mark--done/);
  await expect(mark('שיעור 2')).toHaveClass(/lecture-mark--current/);
  // Strict: only the first gap carries the arrow, never a later not-done lecture.
  await expect(group.locator('.lecture-mark--current')).toHaveCount(1);
  await expect(mark('שיעור 4')).toHaveClass(/lecture-mark--todo/);
  await expect(lectureCount).toHaveText(`2/${LECTURES}`);

  await group.locator('.course-overview-row').click();
  await page.getByRole('button', { name: 'Current lecture' }).click();
  await expect(view).toHaveAttribute('data-lecture', 'שיעור 2');
  await expect(view).toHaveAttribute('data-kind', 'lecture');

  await page.goto(lecturePath(RECITATION, 'recitation'));
  await expect(recitationCount).toHaveText('0/1');
  await toggleDone(RECITATION, 'recitation', true);
  await expect(mark(RECITATION, 'recitation')).toHaveClass(/lecture-mark--done/);
  await expect(recitationCount).toHaveText('1/1');

  await group.locator('.course-overview-row').click();
  const recitationButton = page.getByRole('button', { name: 'Current recitation' });
  await expect(recitationButton).toBeDisabled();
  await expect(page.locator('.current-study', { has: recitationButton })).toContainText(
    'All recitations done',
  );
  await expect(page.getByRole('button', { name: 'Current lecture' })).toBeEnabled();

  // Reverting from the page walks the mark and the count back; the arrow stays at the first gap.
  await row('שיעור 3').click();
  await toggleDone('שיעור 3', 'lecture', false);
  await expect(mark('שיעור 3')).toHaveClass(/lecture-mark--todo/);
  await expect(mark('שיעור 2')).toHaveClass(/lecture-mark--current/);
  await expect(lectureCount).toHaveText(`1/${LECTURES}`);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);

  // A lecture in flight shows a spinner in place of its mark, then its mark again once it settles.
  await providers({ groq: { mode: 'slow', ms: 60_000, match: `${COURSE}/${RUNNING}` } });
  await row(RUNNING).click();
  await expect(view).toHaveAttribute('data-lecture', RUNNING);
  await view.locator('.page-header-actions .btn--primary').click();
  await expect(step(view, 'transcribe')).toHaveAttribute('data-status', 'running', {
    timeout: 30_000,
  });
  await expect(mark(RUNNING)).toHaveClass(/lecture-mark--busy/);
  await expect(mark(RUNNING).locator('.spinner')).toBeVisible();
  // Released, the run stops at summarize on the empty Gemini answer rather than making a real PDF.
  await providers({ groq: 'ok', gemini: 'empty' });
  await waitForIdleRunner();
  await expect(mark(RUNNING)).toHaveClass(/lecture-mark--todo/);
});
