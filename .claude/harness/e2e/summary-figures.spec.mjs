// Summary figures: with the setting on, a lecture whose materials are the slide PDF and PPTX is summarised
// with cropped figures in the editor's PDF pane, and deleting a figure line and saving removes it from the PDF.
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND, DATABASE, bytes, call, saveSettings } from '../lib/api.mjs';
import { test, expect, expectRunComplete, harness, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-dl';
const LECTURE = 'שיעור 8';

const lecture = () =>
  `${DATABASE}/courses/${encodeURIComponent(COURSE)}/lectures/${encodeURIComponent(LECTURE)}`;
const figures = async () => (await call(`${lecture()}/figures`)).body.figures;
const summary = async () => (await call(`${lecture()}/summary`)).body.content;

test.use({ locale: 'en-US' });
test.beforeEach(async () => {
  await reseed();
  await saveSettings({ auto_run: 'off', summary_figures: true });
});
test.afterEach(async () => {
  await expect
    .poll(async () => (await call(`${BACKEND}/status`)).body.runner.running, { timeout: 60_000 })
    .toBe(false);
  await reset();
  await saveSettings({ auto_run: 'full', summary_figures: false });
});

test('figures reach the editor PDF pane, and deleting a figure line removes it from the PDF', async ({
  page,
}) => {
  // One summarize with two Gemini calls, then two real pandoc + tectonic renders.
  test.setTimeout(180_000);
  const shot = (name) =>
    page.screenshot({ path: path.join(harness.evidence, `summary-figures-${name}.png`) });

  // The downloader's upload path: the database's materials route, then the notify it sends.
  for (const file of ['econ-slides.pdf', 'econ-slides.pptx']) {
    await bytes(
      `${lecture()}/materials?kind=lecture&filename=${file}`,
      'POST',
      fs.readFileSync(path.join(harness.fixtures, file)),
      'application/octet-stream',
    );
  }
  await call(`${DATABASE}/notify`, { method: 'POST' });

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  await expect(view).toHaveAttribute('data-lecture', LECTURE);
  await view.locator('.page-header-actions .btn--primary').click();
  await expectRunComplete(view, 120_000);

  // Both PDF pages are cropped by the box call and the PPTX picture is copied as is.
  expect(await figures()).toEqual(['fig1.pdf', 'fig2.pdf', 'fig3.png']);
  const linked = (await summary()).match(/^!\[[^\]]*\]\(figures\/fig\d\.\w+\)$/gm);
  expect(linked).toHaveLength(3);

  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}/edit`);
  const pages = page.locator('.pdf-viewer .react-pdf__Page canvas');
  await expect(pages.first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  await shot('before');
  const pdfBefore = await pdfText();
  expect(pdfBefore.figures).toBe(3);

  // Delete the second figure's line and save: the render no longer has it.
  const editor = page.locator('.markdown-editor .cm-content');
  const buffer = () => editor.evaluate((el) => el.cmTile.view.state.doc.toString());
  const edited = (await buffer()).replace(/^!\[[^\]]*\]\(figures\/fig2\.pdf\)\n*/m, '');
  expect(edited).not.toContain('figures/fig2.pdf');
  await editor.evaluate((el, text) => {
    const { view } = el.cmTile;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, edited);
  await expect(page.locator('.edit-unsaved')).toBeVisible();
  await page.locator('.edit-toolbar-actions .btn--primary').click();
  await expect(page.locator('.edit-unsaved')).toHaveCount(0);

  await expect
    .poll(async () => (await pdfText()).figures, { timeout: 90_000 })
    .toBe(pdfBefore.figures - 1);
  await page.waitForTimeout(1000);
  await shot('after');
  expect(await summary()).not.toContain('figures/fig2.pdf');
});

/** The summary.pdf's figure captions (`איור N`), counted through the backend's pypdfium2. */
async function pdfText() {
  const { execFileSync } = await import('node:child_process');
  const res = await fetch(`${lecture()}/files/summary.pdf`);
  if (!res.ok) throw new Error(`GET summary.pdf answered ${res.status}`);
  const file = path.join(harness.evidence, 'summary-figures.pdf');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const out = execFileSync(
    'uv',
    [
      'run',
      '--project',
      path.resolve(import.meta.dirname, '../../../backend'),
      'python',
      '-c',
      'import pypdfium2 as p,sys,re;d=p.PdfDocument(sys.argv[1]);print(len(re.findall("איור|רויא", "".join(x.get_textpage().get_text_range() for x in d))))',
      file,
    ],
    { encoding: 'utf8' },
  );
  return { figures: Number(out.trim().split('\n').pop()) };
}
