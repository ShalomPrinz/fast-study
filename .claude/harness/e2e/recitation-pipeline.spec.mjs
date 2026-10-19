// A recitation holding only its video runs the whole chain — audio, a multi-chunk transcript, summary,
// PDF and Drive — to a finished page, then the database and the fake Drive hold every output.
import { call, lectureFile } from '../lib/api.mjs';
import { fixtureParagraphs } from '../lib/fixture.mjs';
import {
  test,
  expect,
  driveFile,
  expectStepsDone,
  reseed,
  reset,
  step as stepOf,
  treeLecture,
} from './fixtures.mjs';

const COURSE = 'hb-pipeline';
const RECITATION = 'תרגול 1';
const STEPS = ['audio', 'transcribe', 'summarize', 'pdf', 'drive'];

test.beforeEach(reseed);
test.afterEach(reset);

test('a bare recitation video runs to a PDF uploaded to Drive', async ({ page }) => {
  // A warm run takes well under a minute; the margin covers the PDF step's cold tectonic cache.
  test.setTimeout(240_000);

  await page.goto(
    `/${encodeURIComponent(COURSE)}/${encodeURIComponent(RECITATION)}?kind=recitation`,
  );
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', RECITATION);

  const step = (name) => stepOf(view, name);
  await expect(step('audio')).not.toHaveAttribute('data-status', 'done');
  await expect(view.getByTestId('open-pdf')).toHaveCount(0);

  await view.locator('.page-header-actions .btn--primary').click();
  // Past the start first, so a stale `failed` left by an earlier run never reads as this run's end.
  await expect(step('audio')).toHaveAttribute('data-status', /^(running|done)$/);

  await expectStepsDone(view, STEPS, 90_000);
  await expect(view.locator('.page-header-state--done')).toBeVisible();
  await expect(view.getByTestId('open-pdf')).toBeVisible();
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);

  const entry = await treeLecture(COURSE, RECITATION, 'recitation');
  expect(entry).toBeDefined();
  for (const name of ['audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf', 'drive_url.txt'])
    expect(entry.files[name]?.exists, name).toBe(true);

  // One fake segment per chunk, so more than one fixture paragraph proves the chunks were joined.
  const { body: transcript } = await call(
    lectureFile(COURSE, RECITATION, 'transcript.txt', 'recitation'),
  );
  const joined = fixtureParagraphs().filter((p) => transcript.includes(p.trim()));
  expect(joined.length).toBeGreaterThan(1);

  expect(driveFile('Harness', COURSE, 'Recitations', `${RECITATION}.pdf`)).not.toBeNull();
});
