// A viewer-locked summary.pdf stops "Save & update PDF" with the translated file_locked sentence:
// the editor's DELETE of the old PDF gets the database's 423, so no render (or tectonic) ever starts.
import { test, expect, lock, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-pipeline';
const LECTURE = 'שיעור 5'; // summarised with a seeded summary.pdf

// The catalog's English text for file_locked with `file` set.
const LOCKED = '"summary.pdf" is open in another program. Close it and try again.';

test.use({ locale: 'en-US' });
// Back to the seed first, whatever an earlier run left, so the suite reruns on one stack.
test.beforeEach(reseed);
test.afterEach(reset);

test('a locked summary.pdf stops Save & update PDF with the file_locked message', async ({
  page,
}) => {
  lock(`${COURSE}/${LECTURE}/summary.pdf`);
  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}/edit`);

  // A fresh PDF leaves the button disabled on a clean buffer; a trailing newline makes it dirty.
  const editor = page.locator('.markdown-editor .cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');

  const update = page.locator('.edit-toolbar-actions .btn--primary');
  await expect(update).toBeEnabled();
  await update.click();

  await expect(page.locator('.edit-error')).toHaveText(LOCKED);
  // The refusal leaves the old PDF in place and the button free for a retry.
  await expect(update).toBeEnabled();
});
