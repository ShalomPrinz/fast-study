// A course built from the tree — created, given two lectures and a recitation under the suggested
// names, then a lecture and the course renamed — with the open page following each sanitized name.
import { test, expect, reseed, reset, treeLecture } from './fixtures.mjs';
import { DATABASE, call } from '../lib/api.mjs';

const COURSE = 'hb-crud';
const RENAMED_COURSE = 'hb-crud-2';
// The database drops the `:`, which NTFS refuses, so the folder and the page take the second name.
const TYPED_LECTURE = 'שיעור 2: חזרה';
const RENAMED_LECTURE = 'שיעור 2 חזרה';

// A reseed wipes the data root, so the created course outlives neither this test nor a failed run.
test.beforeEach(reseed);
test.afterEach(async () => {
  await reset();
  await reseed();
});

const courseNames = async () => (await call(`${DATABASE}/tree`)).body.map((c) => c.name);

const pathOf = (page) => decodeURIComponent(new URL(page.url()).pathname);

test('a course is created, filled and renamed from the tree, the open page following', async ({
  page,
}) => {
  await page.goto('/');
  const view = page.getByTestId('lecture-view');

  await page.locator('.new-course-btn').click();
  await page.locator('.new-course-input').fill(COURSE);
  await page.locator('.new-course-input').press('Enter');
  const group = (name) =>
    page.locator('.course-group').filter({
      has: page.locator('.course-header .course-name', { hasText: new RegExp(`^${name}$`) }),
    });
  await expect(group(COURSE)).toBeVisible();

  // An empty course has no prefix to copy, so the suggestion falls back to the UI locale's wording.
  const input = group(COURSE).locator('.lecture-add-input');
  for (const name of ['Lecture 1', 'Lecture 2']) {
    await group(COURSE).locator('.course-header .course-add-btn').click();
    await expect(input).toHaveValue(name);
    await input.press('Enter');
    await expect(view).toHaveAttribute('data-lecture', name);
  }
  await group(COURSE).locator('.recitations-header .course-add-btn').click();
  await expect(input).toHaveValue('Recitation 1');
  await input.press('Enter');
  await expect(view).toHaveAttribute('data-lecture', 'Recitation 1');
  await expect(view).toHaveAttribute('data-kind', 'recitation');
  expect(await treeLecture(COURSE, 'Lecture 1')).toBeDefined();
  expect(await treeLecture(COURSE, 'Lecture 2')).toBeDefined();
  expect(await treeLecture(COURSE, 'Recitation 1', 'recitation')).toBeDefined();

  const row = (name) => group(COURSE).locator(`[data-testid="lecture"][data-lecture="${name}"]`);
  await row('Lecture 2').click();
  await expect(view).toHaveAttribute('data-lecture', 'Lecture 2');
  await row('Lecture 2').click({ modifiers: ['Shift'] });
  await input.fill(TYPED_LECTURE);
  await input.press('Enter');
  await expect(view).toHaveAttribute('data-lecture', RENAMED_LECTURE);
  await expect.poll(() => pathOf(page)).toBe(`/${COURSE}/${RENAMED_LECTURE}`);
  await expect(row(RENAMED_LECTURE)).toBeVisible();
  expect(await treeLecture(COURSE, RENAMED_LECTURE)).toBeDefined();
  expect(await treeLecture(COURSE, 'Lecture 2')).toBeUndefined();

  await group(COURSE)
    .locator('.course-header .course-toggle')
    .click({ modifiers: ['Shift'] });
  // The header's name gives way to the input, so the group no longer matches by name here.
  const courseInput = page.locator('.course-header input');
  await courseInput.fill(RENAMED_COURSE);
  await courseInput.press('Enter');
  await expect(view).toHaveAttribute('data-course', RENAMED_COURSE);
  await expect(view).toHaveAttribute('data-lecture', RENAMED_LECTURE);
  await expect.poll(() => pathOf(page)).toBe(`/${RENAMED_COURSE}/${RENAMED_LECTURE}`);
  await expect(group(RENAMED_COURSE)).toBeVisible();
  expect(await courseNames()).not.toContain(COURSE);
  expect(await treeLecture(RENAMED_COURSE, RENAMED_LECTURE)).toBeDefined();
  expect(await treeLecture(RENAMED_COURSE, 'Recitation 1', 'recitation')).toBeDefined();
  await expect(page.locator('.Toastify__toast--error')).toHaveCount(0);
});
