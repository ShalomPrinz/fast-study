// A course's merged PDF: two summaries ticked, reordered by a real pointer drag, merged into one PDF that
// opens, goes stale when a part's PDF is re-rendered, and is replaced after the overwrite confirm.
import { test, expect, reseed, reset } from './fixtures.mjs';
import { DATABASE, call } from '../lib/api.mjs';
import { minimalPdf } from '../lib/pdf.mjs';

const COURSE = 'hb-merge';
const LECTURE = 'שיעור 1';
const RECITATION = 'תרגול 1';
const TITLE = 'Midterm pack';

const course = `${DATABASE}/courses/${encodeURIComponent(COURSE)}`;

test.use({ locale: 'en-US' });
test.beforeEach(reseed);
test.afterEach(reset);

const part = (page, key) =>
  page.locator(`.merged-order-item > .merged-order-row[data-part="${key}"]`);
const orderKeys = (page) =>
  page
    .locator('.merged-order-item > .merged-order-row')
    .evaluateAll((rows) => rows.map((row) => row.dataset.part));

/** A real hold-and-drag: the sensor arms after 200 ms, so the move waits past it. */
async function dragAbove(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const x = a.x + a.width / 2;
  await page.mouse.move(x, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await expect(from).toHaveClass(/merged-order-row--armed|merged-order-row--dragging/);
  const steps = 12;
  const fromY = a.y + a.height / 2;
  const toY = b.y + b.height / 4;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x, fromY + ((toY - fromY) * i) / steps);
  await page.mouse.up();
}

test('two summaries merge in the dragged order, open, go stale and are replaced', async ({
  page,
  context,
}) => {
  // A newer summary.md than its PDF makes שיעור 2 outdated.
  await call(`${course}/lectures/${encodeURIComponent('שיעור 2')}/files/summary.md`, {
    method: 'PUT',
    body: '# edited\n',
    headers: { 'content-type': 'text/markdown' },
  });

  // Entry is the sidebar row, selected on the history and create pages; Create new sits on the history page.
  await page.goto(`/course/${encodeURIComponent(COURSE)}/overview`);
  const sidebarRow = page.locator('.course-merged-row');
  await expect(sidebarRow).not.toHaveClass(/selected/);
  await sidebarRow.click();
  await expect(page).toHaveURL(new RegExp(`/course/${encodeURIComponent(COURSE)}/merged$`));
  await expect(sidebarRow).toHaveClass(/selected/);
  await page.locator('.merged-history-create').click();
  await expect(page).toHaveURL(/\/merged\/new$/);
  await expect(sidebarRow).toHaveClass(/selected/);
  await expect(page.locator('.merged-create')).toHaveText('Create merged summary');
  await page.locator('#merged-title').fill(TITLE);
  await expect(page.locator('.merged-create')).toBeDisabled();

  // The first heading of summary.md rides under the name.
  await expect(
    page.locator(`.merged-pick[data-part="lecture:${LECTURE}"] .merged-pick-heading`),
  ).toHaveText('סיבוכיות זמן ריצה');

  // The outdated chip asks before re-rendering; Cancel leaves it as it was.
  await page.locator('button.merged-pick-outdated').click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.locator('.modal .btn--ghost').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('button.merged-pick-outdated')).toHaveCount(1);

  // The section checkbox ticks every mergeable lecture (not the one without a PDF); a title click unticks.
  const toggle = page.locator('.merged-section-toggle[data-kind="lecture"]');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => orderKeys(page)).toEqual(['lecture:שיעור 1', 'lecture:שיעור 2']);
  await page.locator('.merged-section-label').first().click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => orderKeys(page)).toEqual([]);

  // A part with no summary.pdf cannot be ticked.
  await expect(page.locator('.merged-pick--missing')).toHaveCount(1);
  await expect(page.locator('.merged-pick[data-part="lecture:שיעור 3"]')).toHaveClass(
    /merged-pick--missing/,
  );

  await page.locator(`.merged-pick[data-part="lecture:${LECTURE}"]`).click();
  await page.locator(`.merged-pick[data-part="recitation:${RECITATION}"]`).click();
  await expect
    .poll(() => orderKeys(page))
    .toEqual([`lecture:${LECTURE}`, `recitation:${RECITATION}`]);

  // A short click on a row never arms the drag, so the order holds.
  await part(page, `recitation:${RECITATION}`).click();
  await expect
    .poll(() => orderKeys(page))
    .toEqual([`lecture:${LECTURE}`, `recitation:${RECITATION}`]);

  await dragAbove(page, part(page, `recitation:${RECITATION}`), part(page, `lecture:${LECTURE}`));
  await expect
    .poll(() => orderKeys(page))
    .toEqual([`recitation:${RECITATION}`, `lecture:${LECTURE}`]);

  await page.locator('.merged-create').click();
  await expect(page).toHaveURL(new RegExp(`/course/${encodeURIComponent(COURSE)}/merged$`));
  const row = page.locator('.merged-row').filter({ hasText: TITLE });
  await expect(row.locator('.merged-part')).toHaveText([RECITATION, LECTURE], { timeout: 30_000 });
  await expect(row).not.toHaveClass(/merged-row--(running|waiting)/);
  await expect(row.getByRole('button', { name: 'Open', exact: true })).toBeVisible();

  // Open: a new tab on the PDF stream route (headless chromium downloads a PDF, so read the response).
  const [opened, popup] = await Promise.all([
    context.waitForEvent('response', (r) => /\/courses\/[^/]+\/merged\/[^/]+\/pdf$/.test(r.url())),
    context.waitForEvent('page'),
    row.getByRole('button', { name: 'Open', exact: true }).click(),
  ]);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toContain('application/pdf');
  expect((await (await page.request.get(opened.url())).body()).subarray(0, 5).toString()).toBe(
    '%PDF-',
  );
  await popup.close();

  // A part's PDF re-rendered (what the pdf step writes): the entry reads as outdated.
  await expect(row.locator('.chip--warn')).toHaveCount(0);
  await call(`${course}/lectures/${encodeURIComponent(LECTURE)}/files/summary.pdf`, {
    method: 'PUT',
    body: minimalPdf({ text: 'edited summary' }),
    headers: { 'content-type': 'application/pdf' },
  });
  // The database announces none of its own writes; the backend's pdf step pings it, so this does too.
  await call(`${DATABASE}/notify`, { method: 'POST' });
  await expect(row.locator('.chip--warn')).toHaveText('Newer version available');
  const before = (await call(`${course}/merged`)).body.merged[0];

  // Re-create with the same title: the overwrite confirm, then Replace, with one part dropped.
  await row.getByRole('button', { name: 'Re-create' }).click();
  await expect(page.locator('#merged-title')).toHaveValue(TITLE);
  await expect
    .poll(() => orderKeys(page))
    .toEqual([`recitation:${RECITATION}`, `lecture:${LECTURE}`]);
  await page.locator(`.merged-pick[data-part="lecture:${LECTURE}"]`).click();
  await page.locator('.merged-create').click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await modal.locator('.btn--ghost').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(() => orderKeys(page)).toEqual([`recitation:${RECITATION}`]);
  await page.locator('.merged-create').click();
  await modal.locator('.btn--primary').click();

  await expect(page).toHaveURL(new RegExp('/merged$'));
  await expect(page.locator('.merged-row').filter({ hasText: TITLE })).toHaveCount(1);
  await expect(row.locator('.merged-part')).toHaveText([RECITATION], { timeout: 30_000 });
  await expect(row.locator('.chip--warn')).toHaveCount(0);
  const list = (await call(`${course}/merged`)).body.merged;
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe(before.name);
  expect(list[0].created_at).not.toBe(before.created_at);
});
