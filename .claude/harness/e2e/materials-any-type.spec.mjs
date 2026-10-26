// Lecture materials of any file type: listed, shown by original name, sent to Gemini only when attached
// and supported, and an attached file over 10 MB fails Summarize.
import fs from 'node:fs';
import { DATABASE, call, saveSettings } from '../lib/api.mjs';
import { loadRecordings, recordingCard } from '../lib/downloads.mjs';
import {
  test,
  expect,
  expectStepsDone,
  geminiUploads,
  harness,
  reseed,
  reset,
  step,
  treeLecture,
} from './fixtures.mjs';

const COURSE = 'hb-dl';
// The fake site's `חומרי עזר` resources (titles from fakes/site.mjs) and the original names they serve.
const PPTX = { title: 'שקפי שיעור 3', file: 'lecture3-slides.pptx' };
const PNG = { title: 'תרשים עצים', file: 'diagram.png' };
const ZIP = { title: 'דוגמאות קוד', file: 'code-samples.zip' };
const MP3_TITLE = 'הקלטת שמע שיעור 3';
const BIG = { title: 'נספח גדול', file: 'big-appendix.pdf' };

test.use({ locale: 'en-US' });
// The seed has none of these lectures, so the reseed also removes what an earlier run made.
test.beforeEach(async () => {
  await reseed();
  await saveSettings({ auto_run: 'off' });
});
test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: 'full' });
});

const lecturePath = (lecture) => `/${encodeURIComponent(COURSE)}/${encodeURIComponent(lecture)}`;

/** Download each resource's Materials row into `lecture`, in order; → the page left on Downloads. */
async function attach(page, lecture, resources) {
  await loadRecordings(page, COURSE);
  await page.locator('.recordings-panel .mode-toggle-btn', { hasText: 'Materials' }).click();
  for (const { title } of resources) {
    const card = recordingCard(page, title);
    await card.getByLabel('Attach material to').fill(lecture);
    await card.locator('.recording-download-btn').click();
    await expect(card.getByText('In course')).toBeVisible({ timeout: 15_000 });
  }
}

const materials = async (lecture) =>
  (
    await call(
      `${DATABASE}/courses/${encodeURIComponent(COURSE)}/lectures/${encodeURIComponent(lecture)}/materials?kind=lecture`,
    )
  ).body.materials;

/** Each downloaded material holds the bytes of its own resource, not another row's. */
const expectOwnBytes = async (lecture, resources) => {
  const sizes = resources.map(({ file }) => fs.statSync(`${harness.fixtures}/${file}`).size);
  expect((await materials(lecture)).map((m) => m.size)).toEqual(sizes);
};

const chip = (view, file) =>
  view.locator('.material-chip').filter({
    has: view.page().locator('.material-chip-name', { hasText: file }),
  });
const toggle = (view, file) => chip(view, file).getByRole('switch');
// The input is visually hidden behind the track, so a click goes to the switch's label.
const flip = (view, file) => chip(view, file).locator('.material-switch').click();
const summarize = (view) => view.locator('.page-header-actions .btn--primary');

test('Downloads lists pptx, png and zip resources as materials and leaves the mp3 out', async ({
  page,
}) => {
  await loadRecordings(page, COURSE);
  await page.locator('.recordings-panel .mode-toggle-btn', { hasText: 'Materials' }).click();
  for (const { title } of [PPTX, PNG, ZIP]) await expect(recordingCard(page, title)).toHaveCount(1);

  // Audio is not a material, and auto lists no other row for it either.
  // Each segment is anchored on a row it holds before the mp3 is checked absent.
  const anchors = { Materials: PPTX.title, Videos: 'הקלטה 4 — גרפים', Unknown: 'קישור לסילבוס' };
  for (const [segment, title] of Object.entries(anchors)) {
    const tab = page.locator('.recordings-panel .mode-toggle-btn', { hasText: segment });
    await tab.click();
    await expect(tab).toHaveClass(/active/);
    await expect(recordingCard(page, title)).toHaveCount(1);
    await expect(recordingCard(page, MP3_TITLE)).toHaveCount(0);
  }
});

test('materials of three types show their original names, and Summarize sends only the attached supported ones', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const LECTURE = 'שיעור 8';

  await attach(page, LECTURE, [PPTX, PNG, ZIP]);
  expect((await materials(LECTURE)).map((m) => m.name)).toEqual([
    'material.pptx',
    'material.2.png',
    'material.3.zip',
  ]);

  await expectOwnBytes(LECTURE, [PPTX, PNG, ZIP]);

  await page.goto(lecturePath(LECTURE));
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  await expect(view.locator('.material-chip-name')).toHaveText([PPTX.file, PNG.file, ZIP.file]);
  await expect(toggle(view, PPTX.file)).toBeChecked();
  await expect(toggle(view, PNG.file)).toBeChecked();
  // Gemini cannot read a zip: its switch is off and cannot be turned on.
  await expect(toggle(view, ZIP.file)).not.toBeChecked();
  await expect(toggle(view, ZIP.file)).toBeDisabled();

  // Not attached means not sent: the png is switched off before the run.
  await flip(view, PNG.file);
  await expect(toggle(view, PNG.file)).not.toBeChecked();

  await summarize(view).click();
  await expectStepsDone(view, ['summarize', 'pdf', 'drive']);
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);

  const uploads = await geminiUploads();
  expect(uploads.map((u) => u.mimeType)).toEqual(['text/plain']);

  // The summary used {pptx}; flipping the png on shows the changed state, flipping it back clears it.
  const changed = view.locator('.material-indicator--changed');
  await expect(changed).toHaveCount(0);
  await flip(view, PNG.file);
  await expect(changed).toBeVisible();
  await flip(view, PNG.file);
  await expect(changed).toHaveCount(0);
});

test('a lecture whose only material is unsupported is not materials-only and cannot be summarised', async ({
  page,
}) => {
  const LECTURE = 'שיעור 9';

  await attach(page, LECTURE, [ZIP]);
  await page.goto(lecturePath(LECTURE));
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  await expect(chip(view, ZIP.file)).toBeVisible();

  // Nothing is sent, so the stages are not skipped as in a materials-only lecture, and no run is offered.
  await expect(view.locator('.pipeline-skipped')).toHaveCount(0);
  await expect(step(view, 'summarize')).not.toHaveAttribute('data-status', 'done');
  await expect(summarize(view)).toHaveCount(0);
  expect((await treeLecture(COURSE, LECTURE)).files['video.mp4'].exists).toBe(false);
});

test('an attached material over 10 MB fails Summarize until it is switched off', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const LECTURE = 'שיעור 10';

  await attach(page, LECTURE, [PPTX, BIG]);
  await expectOwnBytes(LECTURE, [PPTX, BIG]);
  await page.goto(lecturePath(LECTURE));
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  await expect(chip(view, BIG.file)).toBeVisible();

  await summarize(view).click();
  const error = view.getByTestId('lecture-error');
  await expect(error).toContainText(
    `These materials are over 10 MB: ${BIG.file}. Turn them off for the summary, then try again.`,
    { timeout: 45_000 },
  );
  // The size check runs before any upload.
  expect(await geminiUploads()).toEqual([]);

  await flip(view, BIG.file);
  await expect(toggle(view, BIG.file)).not.toBeChecked();
  await summarize(view).click();
  await expectStepsDone(view, ['summarize', 'pdf', 'drive']);
  await expect(error).toHaveCount(0);
  expect((await geminiUploads()).map((u) => u.mimeType)).toEqual(['text/plain']);
});
