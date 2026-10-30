// A video dropped on a tree row is saved to that lecture: into an empty one it starts the pipeline
// on its own under the default auto-run, and over an existing one it replaces the video after a confirm.
import { BACKEND, call, saveSettings } from '../lib/api.mjs';
import {
  test,
  expect,
  dropFile,
  harness,
  providers,
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
  // The run test leaves a run in flight; the backend queue survives a reseed, so drain it first.
  await expect
    .poll(async () => (await call(`${BACKEND}/status`)).body.runner.running, { timeout: 60_000 })
    .toBe(false);
  await reset();
});

test('a video dropped on an empty lecture is saved and its auto-run starts', async ({ page }) => {
  test.setTimeout(60_000);
  const [COURSE, LECTURE] = ['hb-mgmt', 'שיעור 10'];
  // An empty answer ends the run at Summarize, so no PDF render is paid for.
  await providers({ gemini: 'empty' });

  await page.goto(lecturePath(COURSE, LECTURE));
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);

  await dropFile(treeRow(page, COURSE, LECTURE), VIDEO, 'video/mp4');
  await expect(
    page.locator('.Toastify__toast--success', { hasText: `Saved to ${LECTURE}` }),
  ).toBeVisible();

  // No click: AUTO_RUN=full queues the run when the video arrives.
  await expect(step(view, 'audio')).toHaveAttribute('data-status', /^(running|done)$/);
  await expect(step(view, 'summarize')).toHaveAttribute('data-status', 'failed', {
    timeout: 45_000,
  });

  const { files } = await treeLecture(COURSE, LECTURE);
  for (const name of ['video.mp4', 'audio.mp3', 'transcript.txt'])
    expect(files[name].exists, name).toBe(true);
  expect(files['summary.pdf'].exists).toBe(false);
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
