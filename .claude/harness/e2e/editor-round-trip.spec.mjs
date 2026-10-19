// A summary edited in the editor round-trips: Save & update PDF writes it and re-renders the PDF, another
// window's save raises the conflict banner over a dirty buffer, and Restore original brings back the AI text.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, harness, reseed, reset } from './fixtures.mjs';
import { DATABASE, call } from '../lib/api.mjs';

const COURSE = 'hb-edit';
const LECTURE = 'שיעור 1'; // a summary, no PDF yet

const SUMMARY = () =>
  `${DATABASE}/courses/${encodeURIComponent(COURSE)}/lectures/${encodeURIComponent(LECTURE)}/summary`;
const readSummary = async () => (await call(SUMMARY())).body;

test.use({ locale: 'en-US' });
// Back to the seed first, whatever an earlier run left, so the suite reruns on one stack.
test.beforeEach(reseed);
test.afterEach(reset);

test('an edited summary saves, survives another window, and restores', async ({ page }) => {
  // Covers one real pandoc + tectonic render on a warm cache.
  test.setTimeout(100_000);
  const original = fs.readFileSync(path.join(harness.fixtures, 'summary.md'), 'utf8');

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}/edit`);
  const editor = page.locator('.markdown-editor .cm-content');
  const unsaved = page.locator('.edit-unsaved');
  const update = page.locator('.edit-toolbar-actions .btn--primary');
  // CodeMirror renders only the lines in view, so read its state: @codemirror/view 6.4x hangs the
  // EditorView on .cm-content as `cmTile`, the handle EditorView.findFromDOM reads.
  const buffer = () => editor.evaluate((el) => el.cmTile.view.state.doc.toString());

  // Save: a marker line at the end, then the one write path.
  const marker = `harness-marker-${Date.now()}`;
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker);
  await expect(unsaved).toBeVisible();
  await update.click();

  await expect(unsaved).toHaveCount(0);
  await expect(page.locator('.pdf-viewer .react-pdf__Page canvas').first()).toBeVisible({
    timeout: 60_000,
  });
  const saved = await readSummary();
  expect(saved.content).toContain(marker);
  expect(saved.hasOriginal).toBe(true);
  const pdf = await call(
    `${DATABASE}/courses/${encodeURIComponent(COURSE)}/lectures/${encodeURIComponent(LECTURE)}/files/summary.pdf`,
    { method: 'HEAD', expect: false },
  );
  expect(pdf.status).toBe(200);

  // Another window: the same PUT its Save sends, landing under a dirty buffer here.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' local edit');
  await expect(unsaved).toBeVisible();
  const elsewhere = '# Saved in another window\n\nOnly this text.\n';
  await call(SUMMARY(), {
    method: 'PUT',
    body: elsewhere,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

  const conflict = page.locator('.edit-conflict');
  await expect(conflict).toBeVisible();
  await expect(update).toBeDisabled();
  expect((await readSummary()).content).toBe(elsewhere);
  await conflict.getByRole('button', { name: 'Load new version' }).click();
  await expect(conflict).toHaveCount(0);
  await expect(unsaved).toHaveCount(0);
  expect(await buffer()).toBe(elsewhere);

  // Restore original: confirm-gated, and the snapshot goes with it.
  await page.locator('.edit-restore').click();
  await page.locator('.modal-actions .btn--primary').click();
  await expect(page.locator('.edit-restore')).toBeDisabled();
  await expect.poll(buffer).toBe(original);
  const restored = await readSummary();
  expect(restored.content).toBe(original);
  expect(restored.hasOriginal).toBe(false);
});
