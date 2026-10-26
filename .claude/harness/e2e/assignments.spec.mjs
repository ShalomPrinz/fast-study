// Course assignments: listed by section in Downloads, filed into the tree's Assignments group,
// and opened by name.
import fs from 'node:fs';
import { DATABASE, saveSettings } from '../lib/api.mjs';
import { loadRecordings, recordingCard } from '../lib/downloads.mjs';
import { test, expect, harness, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-dl';
// The fake site's assignments (fakes/site.mjs): the first lives in `חומרי עזר`, the second in `תרגולים`.
const FIRST = {
  name: 'תרגיל בית 1',
  section: 'חומרי עזר',
  files: ['ex1-instructions.pdf', 'ex1-starter.py'],
};
const SECOND = { name: 'תרגיל בית 2', section: 'תרגולים', files: ['ex2-instructions.pdf'] };

test.use({ locale: 'en-US' });
test.beforeEach(async () => {
  await reseed();
  await saveSettings({ auto_run: 'off' });
});
test.afterEach(async () => {
  await reset();
  await saveSettings({ auto_run: 'full' });
});

const rowOf = (page, assignment, file) => recordingCard(page, `${assignment.name} — ${file}`);
const sectionOf = (page, title) =>
  page.locator('.recordings-section').filter({
    has: page.locator('.group-header-title', { hasText: title }),
  });

test('assignments are listed by section, downloaded into the tree and opened by name', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loadRecordings(page, COURSE);
  await page.locator('.recordings-panel .mode-toggle-btn', { hasText: 'Assignments' }).click();

  // Each assignment's files sit under the section of the module that holds it.
  for (const assignment of [FIRST, SECOND]) {
    const section = sectionOf(page, assignment.section);
    for (const file of assignment.files) {
      await expect(
        section.locator('.recording-title', { hasText: `${assignment.name} — ${file}` }),
      ).toHaveCount(1);
    }
  }
  await expect(page.locator('.recording-card')).toHaveCount(3);

  // Download both files of the first assignment.
  for (const file of FIRST.files) {
    const card = rowOf(page, FIRST, file);
    await expect(card.getByLabel('Assignment')).toHaveValue(FIRST.name);
    await card.locator('.recording-download-btn').click();
    await expect(card.getByText('In course')).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveClass(/recording-card--downloaded/);
  }
  await expect(rowOf(page, SECOND, SECOND.files[0])).not.toHaveClass(/recording-card--downloaded/);

  // The tree's group lists the assignment, and its view lists both files.
  await page.goto('/');
  await page.locator('.course-toggle', { hasText: COURSE }).first().click();
  const group = page.locator('.recitations-toggle', { hasText: 'Assignments' });
  await expect(group).toBeVisible();
  await group.click();
  await expect(page.getByTestId('assignment')).toHaveText([FIRST.name]);
  await page.getByTestId('assignment').click();
  const view = page.getByTestId('assignment-view');
  await expect(view).toHaveAttribute('data-assignment', FIRST.name);
  await expect(view.getByTestId('assignment-file')).toHaveCount(2);
  for (const file of FIRST.files) await expect(view.getByText(file, { exact: true })).toBeVisible();

  // No launcher in the harness: Show in folder is off with its tooltip, and Open with… is absent.
  const reveal = view.locator('.assignment-file-reveal').first();
  await expect(reveal).toBeDisabled();
  await reveal.hover({ force: true });
  await expect(
    page.getByRole('tooltip').filter({ hasText: 'Needs the desktop app' }),
  ).toBeVisible();
  await expect(view.getByRole('button', { name: 'More actions' })).toHaveCount(0);

  // A file name opens the database's file route in a new tab.
  const file = FIRST.files[0];
  // Headless chromium has no PDF viewer, so the new tab's own URL stays blank: read the request it makes (the database by `localhost`).
  const route = `/courses/${encodeURIComponent(COURSE)}/assignments/${encodeURIComponent(FIRST.name)}/files/${encodeURIComponent(file)}`;
  const requested = context.waitForEvent('request', (r) => new URL(r.url()).pathname === route);
  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    view.getByRole('button', { name: file }).click(),
  ]);
  const request = await requested;
  expect(request.method()).toBe('GET');
  const response = await request.response();
  expect(response.status()).toBe(200);
  // Chromium drops the body of a PDF tab's response, so the route's own bytes are compared to the fixture (ex1-instructions.pdf is handout.pdf).
  const body = await (await context.request.get(`${DATABASE}${route}`)).body();
  expect(body).toEqual(fs.readFileSync(`${harness.fixtures}/handout.pdf`));
  await tab.close();
});
