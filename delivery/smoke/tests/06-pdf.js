import path from 'node:path';
import { expect } from '@playwright/test';
import { formatsSnapshot } from '../lib/formats.js';
import { carriesPhrase, pdfText } from '../lib/pdf.js';
import { services, session } from '../lib/session.js';
import { COURSE, fixture, LECTURE, PDF_PHRASE } from '../lib/suite.js';

// Text inside fixtures/figures/fig1.pdf, a slide graph cropped the way summary figures are.
const FIGURE_PHRASE = 'Good X';
// What test 6 appends to the fixed summary: one PDF and one PNG figure, linked as the app links them.
const FIGURE_LINES = '\n\n![גרף](figures/fig1.pdf)\n\n![תרשים](figures/fig2.png)\n';

export default async function pdfForReal() {
  const { page } = session;
  const { db, api } = services;
  const before = formatsSnapshot();
  for (const figure of ['fig1.pdf', 'fig2.png']) {
    await db.putFigure(COURSE, LECTURE, figure, fixture(path.join('figures', figure)));
  }
  await db.putSummary(COURSE, LECTURE, fixture('summary.md').toString('utf8') + FIGURE_LINES);

  expect(await api.runStep(COURSE, LECTURE, 'pdf'), 'the PDF step failed').toBeNull();
  const pdf = (await db.entry(COURSE, LECTURE)).files['summary.pdf'];
  expect(pdf.exists, 'no summary.pdf').toBe(true);
  expect(pdf.warning, 'the render left a .pdf_warning').toBeUndefined();
  // tectonic's stderr never reaches the API, so an untouched formats/ is the proof the shipped .fmt was reused.
  expect(formatsSnapshot(), 'the render built or rewrote a file under latex/formats/').toEqual(
    before,
  );

  const text = await pdfText(await db.bytes(COURSE, LECTURE, 'summary.pdf'));
  expect(carriesPhrase(text, PDF_PHRASE), 'summary.pdf dropped glyphs of the fixed summary').toBe(
    true,
  );
  // Absent, the shipped drop_missing_images.lua lost the staged figure or tectonic could not include it.
  expect(carriesPhrase(text, FIGURE_PHRASE), 'summary.pdf lacks the PDF figure').toBe(true);
  // A complete lecture folds its step rows into one row.
  await expect(page.getByTestId('pipeline-collapsed')).toBeVisible();
}
