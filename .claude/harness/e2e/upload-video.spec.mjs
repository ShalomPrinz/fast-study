// A video dropped on a tree row is saved to that lecture: into an empty one it runs the whole pipeline
// on its own under the default auto-run, and over an existing one it replaces the video after a confirm.
import { saveSettings } from '../lib/api.mjs';
import {
  test,
  expect,
  dropFile,
  expectStepsDone,
  harness,
  reseed,
  reset,
  step,
  treeLecture,
} from './fixtures.mjs';

const VIDEO = `${harness.fixtures}/video.mp4`;

const lecturePath = (course, lecture) =>
  `/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`;
const treeRow = (page, course, lecture) =>
  page.locator(`[data-testid="lecture"][data-course="${course}"][data-lecture="${lecture}"]`);

test.use({ locale: 'en-US' });
// Back to the seed first, whatever an earlier run left, so the suite reruns on one stack.
test.beforeEach(reseed);
test.afterEach(async () => {
  await saveSettings({ auto_run: 'full' });
  await reset();
});

test('a video dropped on an empty lecture is saved and runs to a finished lecture', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const [COURSE, LECTURE] = ['hb-mgmt', 'שיעור 10'];

  await page.goto(lecturePath(COURSE, LECTURE));
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);

  await dropFile(treeRow(page, COURSE, LECTURE), VIDEO, 'video/mp4');
  await expect(
    page.locator('.Toastify__toast--success', { hasText: `Saved to ${LECTURE}` }),
  ).toBeVisible();

  // No click: AUTO_RUN=full queues the run when the video arrives. Past the start first, so a
  // stale `failed` an earlier run left never reads as this run's end.
  await expect(step(view, 'audio')).toHaveAttribute('data-status', /^(running|done)$/);
  await expectStepsDone(view, ['audio', 'transcribe', 'summarize', 'pdf', 'drive'], 90_000);
  await expect(view.getByTestId('open-pdf')).toBeVisible();
  await expect(view.locator('.page-header-state--done')).toBeVisible();
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);

  const { files } = await treeLecture(COURSE, LECTURE);
  for (const name of ['video.mp4', 'audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf'])
    expect(files[name].exists, name).toBe(true);
});

test('a video dropped on a lecture that has one replaces it and keeps the materials', async ({
  page,
}) => {
  await saveSettings({ auto_run: 'off' });
  const [COURSE, LECTURE] = ['hb-nav', 'שיעור 2'];

  await page.goto(lecturePath(COURSE, LECTURE));
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  await expect(step(view, 'summarize')).toHaveAttribute('data-status', 'done');

  await dropFile(treeRow(page, COURSE, LECTURE), VIDEO, 'video/mp4');
  await page.locator('.modal-actions .btn--primary').click();
  await expect(
    page.locator('.Toastify__toast--success', { hasText: `Saved to ${LECTURE}` }),
  ).toBeVisible();

  // The derived files are wiped, so their rows fall back; the material chip stays.
  await expect(step(view, 'transcribe')).not.toHaveAttribute('data-status', 'done');
  await expect(step(view, 'summarize')).not.toHaveAttribute('data-status', 'done');
  await expect(view.locator('.material-chip-name')).toHaveText(['material.pdf']);

  const { files, materials } = await treeLecture(COURSE, LECTURE);
  expect(files['transcript.txt'].exists).toBe(false);
  expect(files['summary.md'].exists).toBe(false);
  expect(files['video.mp4'].exists).toBe(true);
  expect(materials.map((m) => m.name)).toEqual(['material.pdf']);
});
