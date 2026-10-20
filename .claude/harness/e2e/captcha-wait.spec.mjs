// Downloads → University with the course site behind Radware: a row's Download meets the captcha,
// waits while the banner asks for it, and carries on by itself once it is solved — no Retry, no
// second click — or fails with site_captcha_timeout when nobody solves it.
import { DATABASE, call, saveSettings } from '../lib/api.mjs';
import { loadRecordings, showRecording } from '../lib/downloads.mjs';
import { restart } from '../lib/stack.mjs';
import { expect, harness, reseed, reset, site, test, treeLecture } from './fixtures.mjs';

const COURSE = 'hb-dl';
// The videostream row: its .mp4 lives off the Moodle host, as on BIU, so only the WS call is walled.
const VIDEOSTREAM = 'הקלטה 4 — גרפים';
// A one-file resource: a pluginfile PDF, streamed through auto's routed preflight and stream.
const PDF = 'סיכום שיעור 1';
// auto answers a resolve it already made for a target name from its replay cache, with no Moodle
// call to wall, so each download lands under a name no earlier run used; the reseed removes it.
const freshLecture = () => `שיעור ${100 + (Date.now() % 100_000)}`;

const SOLVED = 'Captcha solved. Continuing.';
const TIMED_OUT = "The captcha on the university site wasn't solved within 10 minutes.";

let autoRun;

test.use({ locale: 'en-US' });

// The reseed's Disconnect deletes the challenge profile and its reset revokes every clearance, so
// each test meets a fresh captcha.
test.beforeEach(async () => {
  await reseed();
  autoRun = (await call(`${DATABASE}/settings`)).body.auto_run;
  await saveSettings({ auto_run: 'off' });
});

test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: autoRun });
});

// The list loads (and `prepare` edits the row) before the wall goes up, so only the download itself
// meets the captcha.
async function downloadBehindWall(page, title, prepare = async () => {}) {
  await site({ downloadMs: 500 });
  await loadRecordings(page, COURSE);
  const card = await showRecording(page, title);
  await prepare(card);
  await site({ mode: 'radware' });
  await card.locator('.recording-download-btn').click();
  await expect(page.locator('.captcha-banner')).toBeVisible({ timeout: 15_000 });
  return card;
}

// After the solve nothing is clicked: the toast, the banner and the row move on their own.
async function expectContinued(page, card) {
  await site({ solve: true });
  await expect(page.locator('.Toastify__toast--success', { hasText: SOLVED })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.captcha-banner')).toHaveCount(0);
  await expect(card.locator('.recording-download-btn', { hasText: 'Retry' })).toHaveCount(0);
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);
}

test('a videostream download waits for the captcha and lands once it is solved', async ({
  page,
}) => {
  const lecture = freshLecture();
  const card = await downloadBehindWall(page, VIDEOSTREAM, (row) =>
    row.locator('.recording-name-input').fill(lecture),
  );
  await expectContinued(page, card);
  await expect(card).toHaveClass(/recording-card--downloaded/, { timeout: 15_000 });
  expect((await treeLecture(COURSE, lecture)).files['video.mp4'].exists).toBe(true);
});

test('a course PDF download waits for the captcha and attaches once it is solved', async ({
  page,
}) => {
  const lecture = freshLecture();
  const card = await downloadBehindWall(page, PDF, (row) =>
    row.getByLabel('Attach material to').fill(lecture),
  );
  await expectContinued(page, card);
  await expect(card.locator('.recording-material-count')).toHaveText('1 material', {
    timeout: 15_000,
  });
  const { materials } = (
    await call(
      `${DATABASE}/courses/${COURSE}/lectures/${encodeURIComponent(lecture)}/materials?kind=lecture`,
    )
  ).body;
  expect(materials.map((m) => m.name)).toEqual(['material.pdf']);
});

test.describe('with nobody to solve it', () => {
  // auto/'s 10-minute wait, cut to seconds for this block alone; the empty value restores it.
  test.beforeAll(async () => {
    await restart(harness, 'downloader-auto', { HARNESS_CAPTCHA_MS: '3000' });
  });
  test.afterAll(async () => {
    await restart(harness, 'downloader-auto', { HARNESS_CAPTCHA_MS: '' });
  });

  test('an unsolved captcha fails the download with site_captcha_timeout', async ({ page }) => {
    const lecture = freshLecture();
    await downloadBehindWall(page, VIDEOSTREAM, (row) =>
      row.locator('.recording-name-input').fill(lecture),
    );
    await expect(page.getByText(TIMED_OUT)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.captcha-banner')).toHaveCount(0);
    expect(await treeLecture(COURSE, lecture)).toBeUndefined();
  });
});
