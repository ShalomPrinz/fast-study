// Downloads → University as a user drives it, on a Playwright page: a spec imports these, and
// `hb download` runs the same code inside a browser session.
import { appUrl } from './browser.mjs';

const exactly = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** The recording card titled `title` (a substring, as Playwright's hasText reads it). */
export const recordingCard = (page, title) =>
  page
    .locator('.recording-card')
    .filter({ has: page.locator('.recording-title', { hasText: title }) });

/** Open Downloads' University tab, load `course` off its source and switch the list to All, the old per-card view; → its source row. */
export async function loadRecordings(page, course) {
  await page.goto(new URL('/downloads', appUrl()).href);
  await page.locator('.downloads-tabs [role=tab]').first().click();
  const source = page.locator('.source-row').filter({
    has: page.locator('.source-row-name', { hasText: exactly(course) }),
  });
  await source.locator('.source-row-actions .btn').click();
  await source.locator('.chip--accent').waitFor();
  await page.locator('.downloads-scope-switch .mode-toggle-btn', { hasText: 'All' }).click();
  return source;
}

/** Open the loaded list's segment (Videos, Materials, Unknown) holding `title`; → its card. */
export async function showRecording(page, title) {
  const card = recordingCard(page, title);
  const shown = () =>
    card.waitFor({ timeout: 1_000 }).then(
      () => true,
      () => false,
    );
  if (await shown()) return card;
  for (const segment of await page
    .locator('.recordings-panel .mode-toggle--cards .mode-toggle-btn')
    .all()) {
    await segment.click();
    if (await shown()) return card;
  }
  throw new Error(`no recording titled "${title}" in the loaded list`);
}

/** Load `course`'s recordings and press Download on the row titled `title`; → its card. */
export async function downloadRecording(page, course, title) {
  await loadRecordings(page, course);
  const card = await showRecording(page, title);
  await card.locator('.recording-download-btn').click();
  return card;
}
