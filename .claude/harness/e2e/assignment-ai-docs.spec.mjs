// Assignment AI docs: one assignment's guide generated, edited, regenerated and copied, and a failed
// solution on its own card.
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE, PROVIDERS, call, json } from '../lib/api.mjs';
import { test, expect, harness, providers, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-assign';
const ASSIGNMENT = 'תרגיל בית 1';
const LECTURE = 'שיעור 1';
const ON = 'ex1-instructions.pdf'; // application/pdf, stays switched on
const OFF = 'ex1-data.txt'; // text/plain, switched off

const encode = encodeURIComponent;
const docUrl = (doc) =>
  `${DATABASE}/courses/${encode(COURSE)}/assignments/${encode(ASSIGNMENT)}/docs/${doc}`;
const pdfUrl = (doc) =>
  `${DATABASE}/courses/${encode(COURSE)}/assignments/${encode(ASSIGNMENT)}/generated/${doc}.pdf`;
// Trimmed: the backend writes a doc without the fixture's trailing newline.
const fixture = (name) => fs.readFileSync(path.join(harness.fixtures, name), 'utf8').trim();
const readDoc = async (doc) => (await call(docUrl(doc))).body;
// The PDF's mtime as the tree reports it, null while there is none.
const pdfMtime = async (doc) => {
  const { body: tree } = await call(`${DATABASE}/tree`);
  const node = tree.find((c) => c.name === COURSE).assignments.find((a) => a.name === ASSIGNMENT);
  return node.docs[doc]?.pdf_mtime ?? null;
};
const assignmentCalls = async () => (await json(`${PROVIDERS}/assignment-calls`, 'GET')).body.calls;

// The full app window, as `hb shot` takes it.
const shot = (page, name) =>
  page.screenshot({ path: path.join(harness.evidence, `assignment-ai-docs-${name}.png`) });

// Chromium is headless here: the clipboard needs its permissions granted, and the AI chat's tab never leaves the box.
test.use({ locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] });
test.beforeEach(reseed);
test.afterEach(reset);

test('an assignment generates, edits, regenerates, copies and fails per doc', async ({
  page,
  context,
}) => {
  // Two Gemini writes, four PDF renders (generate, open, save, regenerate) on a warm tectonic cache.
  test.setTimeout(240_000);
  await context.route('https://claude.ai/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>chat</title>' }),
  );
  await page.goto(`/course/${encode(COURSE)}/assignment/${encode(ASSIGNMENT)}`);
  const view = page.getByTestId('assignment-view');
  await expect(view).toHaveAttribute('data-assignment', ASSIGNMENT);
  const intuition = view.locator('.doc-card[data-doc="intuition"]');
  const solution = view.locator('.doc-card[data-doc="solution"]');

  // 1. Toggle one file off.
  const onSwitch = view.getByRole('switch', { name: `Send ${ON} to Gemini` });
  const offSwitch = view.getByRole('switch', { name: `Send ${OFF} to Gemini` });
  await expect(onSwitch).toBeChecked();
  await expect(offSwitch).toBeChecked();
  await offSwitch.locator('xpath=ancestor::label').click();
  await expect(offSwitch).not.toBeChecked();
  await expect(onSwitch).toBeChecked();
  await expect(intuition).toContainText('1 file and 0 summaries will be sent to Gemini');

  // 2. Pick one lecture.
  await view.getByRole('button', { name: 'Add a lecture or recitation' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a lecture or recitation' });
  // Controlled by the tree: it flips once the write's refresh lands, so click, then wait.
  const option = picker.getByRole('checkbox', { name: new RegExp(LECTURE) });
  await option.click();
  await expect(option).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(view.locator('.course-material-chips')).toContainText(LECTURE);
  await expect(view).toContainText('2 files · 1 lecture attached');
  await expect(intuition).toContainText('1 file and 1 summary will be sent to Gemini');
  await shot(page, '1-inputs');

  // 3. Generate the Intuition Guide: Gemini got the switched-on file and the summary, not the other file.
  await intuition.getByRole('button', { name: 'Create guide' }).click();
  await expect(intuition).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  const [generated, ...rest] = await assignmentCalls();
  expect(rest).toEqual([]);
  expect(generated.doc).toBe('intuition');
  expect(generated.files).toEqual(['application/pdf']); // the switched-off text file is absent
  expect(generated.summaries).toEqual([
    expect.objectContaining({ kind: 'lecture', title: LECTURE }),
  ]);
  expect((await readDoc('intuition')).content).toBe(fixture('assignment-intuition.md'));
  await expect(intuition.locator('.doc-card-ready')).toContainText('Ready');
  await expect(intuition.getByRole('button', { name: 'Open PDF' })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(intuition.locator('.doc-card-error')).toHaveCount(0);
  await shot(page, '2-generated');

  // 4. Open the PDF: a new tab asks the database for the rendered file.
  const route = new URL(pdfUrl('intuition')).pathname;
  const requested = context.waitForEvent('request', (r) => new URL(r.url()).pathname === route);
  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    intuition.getByRole('button', { name: 'Open PDF' }).click(),
  ]);
  const request = await requested;
  expect((await request.response()).status()).toBe(200);
  await tab.close();

  // 5. Edit and save: the buffer writes, the PDF re-renders, and the card follows.
  await intuition.getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/course/${encode(COURSE)}/assignment/${encode(ASSIGNMENT)}/edit/intuition$`),
  );
  await expect(page.locator('.edit-title')).toHaveText(`Intuition Guide — ${ASSIGNMENT}`);
  const editor = page.locator('.markdown-editor .cm-content');
  const marker = `harness-marker-${Date.now()}`;
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker);
  await expect(page.locator('.edit-unsaved')).toBeVisible();
  const mtimeBefore = await pdfMtime('intuition');
  expect(mtimeBefore).not.toBeNull();
  await page.locator('.edit-toolbar-actions .btn--primary').click();
  await expect(page.locator('.edit-unsaved')).toHaveCount(0);
  await expect(page.locator('.pdf-viewer .react-pdf__Page canvas').first()).toBeVisible({
    timeout: 60_000,
  });
  const saved = await readDoc('intuition');
  expect(saved.content).toContain(marker);
  expect(saved.hasOriginal).toBe(true);
  expect(await pdfMtime('intuition')).toBeGreaterThan(mtimeBefore);
  await shot(page, '3-edited');
  await page.locator('.edit-back').click();
  await expect(intuition).toHaveAttribute('data-state', 'ready');

  // 6. Regenerate: the confirm names the doc, and the new text replaces the edit.
  await intuition.getByRole('button', { name: 'Regenerate' }).click();
  const confirm = page.locator('.modal');
  await expect(confirm).toContainText('Regenerate Intuition Guide?');
  await expect(confirm).toContainText('Gemini will write it again.');
  await shot(page, '4-regenerate-confirm');
  await confirm.getByRole('button', { name: 'Regenerate' }).click();
  await expect.poll(async () => (await assignmentCalls()).length, { timeout: 60_000 }).toBe(2);
  await expect
    .poll(async () => (await readDoc('intuition')).content, { timeout: 60_000 })
    .toBe(fixture('assignment-intuition.md'));
  expect((await readDoc('intuition')).content).not.toContain(marker);
  expect((await readDoc('intuition')).hasOriginal).toBe(false);
  await expect(intuition.getByRole('button', { name: 'Open PDF' })).toBeEnabled({
    timeout: 60_000,
  });

  // 7. Study with AI copies the chosen summary and the guide, then opens the chat.
  const popup = context.waitForEvent('page');
  await view.getByRole('button', { name: 'Open chat' }).click();
  expect((await popup).url()).toContain('claude.ai/new');
  await expect(page.getByText('Assignment material copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("I'm working on this assignment and want to understand it in depth");
  expect(copied).toContain(`<assignment course="${COURSE}" title="${ASSIGNMENT}">`);
  expect(copied).toContain(`<lecture kind="lecture" title="${LECTURE}">`);
  expect(copied).toContain(fixture('summary.md'));
  expect(copied).toContain('<intuition_guide>');
  expect(copied).toContain(fixture('assignment-intuition.md'));
  expect(copied).not.toContain('<solution>');
  await shot(page, '5-copied');

  // 8. A failed Full Solution renders its error on its own card; the guide's stays clean.
  await providers({ gemini: { mode: '500', match: 'Assignments' } });
  await solution.getByRole('button', { name: 'Create solution' }).click();
  const error = solution.getByRole('alert');
  await expect(error).toContainText("Gemini couldn't write this document.", { timeout: 60_000 });
  await expect(solution).toHaveAttribute('data-state', 'none');
  await expect(solution.getByRole('button', { name: 'Create solution' })).toBeEnabled();
  await expect(intuition.locator('.doc-card-error')).toHaveCount(0);
  expect((await call(docUrl('solution'), { expect: false })).status).toBe(404);
  await error.scrollIntoViewIfNeeded(); // below the fold of the window
  await shot(page, '6-solution-failed');
});
