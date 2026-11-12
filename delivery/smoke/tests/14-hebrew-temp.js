import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { readLaunchLog } from '../lib/app.js';
import { tone } from '../lib/media.js';
import * as paths from '../lib/paths.js';
import { carriesPhrase, pdfText } from '../lib/pdf.js';
import { services, start, stop } from '../lib/session.js';
import { COURSE, fixture, PDF_PHRASE } from '../lib/suite.js';

const TEMP_LECTURE = 'Hebrew Temp Lecture';

export default async function hebrewTemp() {
  await stop();
  // Hebrew and a space in the dir every service spawns its tools in, as a Windows username can put in %TEMP%.
  const folder = 'טמפ עברי';
  const temp = path.join(paths.workDir(), folder);
  fs.mkdirSync(temp, { recursive: true });
  // TMPDIR too: Python's tempfile reads it ahead of TEMP, and a runner shell may set it.
  await start({ TEMP: temp, TMP: temp, TMPDIR: temp });
  const { db, api } = services;
  const broke = `a tool breaks on the non-ASCII temp path ${temp}`;

  /** Run one step while watching the temp folder: each step's workspace is a tempdir made directly in it. */
  async function runInTemp(step) {
    const entries = new Set();
    const watcher = fs.watch(temp, (_, name) => name && entries.add(name));
    try {
      expect(
        await api.runStep(COURSE, TEMP_LECTURE, step),
        `the ${step} step failed: ${broke}`,
      ).toBeNull();
    } finally {
      watcher.close();
    }
    expect(
      entries.size,
      `the ${step} step made nothing in ${temp}: the service ignored TEMP, so this check proved nothing`,
    ).toBeGreaterThan(0);
  }

  await db.putVideo(COURSE, TEMP_LECTURE, await tone());
  await runInTemp('audio');
  await db.putSummary(COURSE, TEMP_LECTURE, fixture('summary.md').toString('utf8'));
  await runInTemp('pdf');

  const pdf = (await db.entry(COURSE, TEMP_LECTURE)).files['summary.pdf'];
  expect(pdf.exists, `no summary.pdf: ${broke}`).toBe(true);
  expect(pdf.warning, `the render left a .pdf_warning: ${broke}`).toBeUndefined();
  const text = await pdfText(await db.bytes(COURSE, TEMP_LECTURE, 'summary.pdf'));
  expect(carriesPhrase(text, PDF_PHRASE), `summary.pdf dropped glyphs: ${broke}`).toBe(true);

  // The audio step logs its temp path, so the folder name is Hebrew the backend wrote to launch.log.
  const log = readLaunchLog();
  const notUtf8 = "the frozen services did not write UTF-8 (services.spec's `X utf8=1`)";
  expect(log.includes(folder), `${notUtf8}, so Hebrew is lost from launch.log`).toBe(true);
  expect(log.includes('\\u05'), `${notUtf8}, so Hebrew is escaped in launch.log`).toBe(false);
  await stop();
}
