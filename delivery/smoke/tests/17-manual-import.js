import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { byTestId } from '../lib/lecture.js';
import { tone } from '../lib/media.js';
import * as paths from '../lib/paths.js';
import { evidence, otherVolume, releaseOtherVolume } from '../lib/platform.js';
import { services, session } from '../lib/session.js';

const IMPORT_COURSE = 'Import Course';
// Large enough to be a real chunked copy, small enough not to slow the run.
const PADDING_BYTES = 96 * 1024 * 1024;
const DONE_TIMEOUT_MS = 180_000;
const SHOTS = 'import-screenshots';
// Bounds each Electron-side action, so a system prompt cannot stall one until the test timeout.
const ACTION_TIMEOUT_MS = 30_000;
const act = { timeout: ACTION_TIMEOUT_MS };

const sameFile = (a, b) => fs.realpathSync.native(a) === fs.realpathSync.native(b);

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

/** A real .mp4 (the tone video) followed by a top-level `free` atom of zeros, so the file is a valid
 *  container the size of a lecture. The atom opens with `label`, so no two sources hash alike; `name`
 *  is the file name when it should differ from `label` (a Hebrew one, with a space and a hyphen). */
async function makeSource(dir, label, name = `${label}.mp4`) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const head = Buffer.alloc(8 + 64);
  head.writeUInt32BE(PADDING_BYTES, 0);
  head.write('free', 4, 'ascii');
  head.write(label, 8, 'utf8');
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, await tone());
    fs.writeSync(fd, head);
    const zeros = Buffer.alloc(1024 * 1024);
    for (let left = PADDING_BYTES - head.length; left > 0; left -= zeros.length) {
      fs.writeSync(fd, zeros, 0, Math.min(left, zeros.length));
    }
  } finally {
    fs.closeSync(fd);
  }
  return {
    file,
    size: fs.statSync(file).size,
    dev: fs.statSync(file).dev,
    sha: await sha256(file),
  };
}

/** A full-window screenshot of the real app, kept in the output, the logs artifact and the report. */
async function shot(page, label, stage, shots) {
  const name = `${label}-${stage}.png`;
  const file = path.join(paths.resultsDir(), SHOTS, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
  shots.push(`${SHOTS}/${name}`);
}

/** Drive one import through Downloads → Manual → File from computer: the file chosen by path, the form
 *  filled, Copy or Move clicked, then the card followed to its end (or `waitMs`). Answers what it saw. */
async function runLeg({ label, mode, source, lecture, waitMs = DONE_TIMEOUT_MS }) {
  const { page } = session;
  const seen = { label, mode, lecture, shots: [], running: false };

  // A fresh page resets the form: the file input exists only while no file is chosen.
  await page.goto('app://bundle/downloads');
  await byTestId(page, 'downloads-tab', { tab: 'manual' }).click(act);
  await byTestId(page, 'manual-source', { source: 'file' }).click(act);

  // Captured before the app's own handler, which clears the input once it has the File.
  await page.evaluate(() => {
    window.__smokePicked = null;
    document.addEventListener(
      'change',
      (event) => {
        const file = event.target?.files?.[0];
        if (file) window.__smokePicked = window.faststudy.pathForFile(file);
      },
      { capture: true, once: true },
    );
  });
  await byTestId(page, 'manual-file-input').setInputFiles(source.file, act);
  await expect
    .poll(() => page.evaluate(() => window.__smokePicked), {
      message:
        'no file was chosen or the preload bridge gave no path for it (setInputFiles may have ignored a non-ASCII path, or webUtils.getPathForFile failed)',
    })
    .toBeTruthy();
  seen.picked = await page.evaluate(() => window.__smokePicked);
  expect(sameFile(seen.picked, source.file), `pathForFile answered ${seen.picked}`).toBe(true);

  await byTestId(page, 'manual-course-input').fill(IMPORT_COURSE, act);
  // The course combobox's listbox floats over the form; close it before the controls under it.
  await page.keyboard.press('Escape');
  const kind = byTestId(page, 'manual-kind', { kind: 'lecture' });
  if (await kind.count()) await kind.click(act);
  await byTestId(page, 'manual-name-input').fill(lecture, act);
  // Move is disabled without a path, so enabled is the bridge's proof as the page sees it.
  await expect(byTestId(page, 'manual-import-start', { mode: 'move' })).toBeEnabled();
  await expect(byTestId(page, 'manual-import-start', { mode })).toBeEnabled();
  await shot(page, label, '1-chosen', seen.shots);

  await byTestId(page, 'manual-import-start', { mode }).click(act);
  const card = byTestId(page, 'manual-import', { course: IMPORT_COURSE, lecture, mode });
  await expect(card).toBeVisible();
  // Best effort: a local copy can end before the page is photographed.
  if ((await card.getAttribute('data-status')) === 'running') {
    seen.running = true;
    await shot(page, label, '2-running', seen.shots);
  }
  try {
    await expect(card).toHaveAttribute('data-status', /^(done|error|cancelled)$/, {
      timeout: waitMs,
    });
  } catch {
    seen.status = 'stuck';
    return seen;
  }
  seen.status = await card.getAttribute('data-status');
  seen.code = await card.getAttribute('data-code');
  seen.kept = await card.getAttribute('data-original-kept');
  await shot(page, label, seen.status === 'done' ? '3-done' : '3-failed', seen.shots);
  return seen;
}

/** What a finished import must have left, read through `database/` and the source's own path. */
async function expectImported(seen, source, lecture, { sameVolume }) {
  const { db } = services;
  expect(seen.status, `the import ended ${seen.status}, code ${seen.code}`).toBe('done');
  expect(await db.exists(IMPORT_COURSE, lecture, 'video.mp4'), 'no video.mp4 in the lecture').toBe(
    true,
  );
  const dest = await db.path(IMPORT_COURSE, lecture, 'video.mp4');
  const stat = fs.statSync(dest);
  seen.dest = dest;
  expect(stat.size, 'video.mp4 is not the source size').toBe(source.size);
  const bytes = await db.bytes(IMPORT_COURSE, lecture, 'video.mp4');
  expect(crypto.createHash('sha256').update(bytes).digest('hex'), 'video.mp4 differs').toBe(
    source.sha,
  );
  expect(
    stat.dev === source.dev,
    `the source ${sameVolume ? 'is not' : 'is'} on the data root's volume`,
  ).toBe(sameVolume);
  if (seen.mode === 'copy') {
    // original-kept is true only when a Move could not delete its source; a Copy never raises it.
    expect(seen.kept, 'a Copy must raise no original-kept notice').toBe('false');
    expect(fs.existsSync(source.file), 'a Copy removed its source').toBe(true);
    expect(fs.statSync(source.file).size, 'a Copy changed its source').toBe(source.size);
  } else {
    expect(seen.kept, 'a Move must not report a source it failed to remove').toBe('false');
    expect(fs.existsSync(source.file), 'a Move left its source behind').toBe(false);
  }
}

const describe = (seen) =>
  [
    `${seen.label}: ${seen.mode} → ${seen.lecture}: ${seen.status}` +
      (seen.code ? ` (code ${seen.code})` : '') +
      (seen.kept ? `, original-kept notice ${seen.kept}` : ''),
    `  bridge path: ${seen.picked ?? 'none'}`,
    `  video.mp4: ${seen.dest ?? 'none'}`,
    `  screenshots${seen.running ? '' : ' (finished before the running one could be taken)'}: ${seen.shots.join(', ') || 'none'}`,
  ].join('\n');

/** Downloads → Manual → File from computer, by path through the packaged preload and the frozen database:
 *  Copy and Move from another volume (Hebrew source names), Move on the data root's volume (ASCII). `guard` (macOS) puts the first source
 *  where a privacy prompt may stand and records what the read did, retrying from a neutral folder. */
export async function manualImport({ guard } = {}) {
  const { api } = services;
  const { applied } = await api.config({ auto_run: 'off' });
  expect(applied, 'the backend did not apply auto_run').toContain('auto_run');

  const neutral = path.join(paths.workDir(), 'import-source');
  const notes = [];
  const dirs = [neutral];
  let sameDir = guard?.sourceDir ?? neutral;
  if (guard) dirs.push(sameDir);
  try {
    // 1. Copy.
    const hebrewCopy = 'הרצאה 5 - הקלטה.mp4';
    let source = await makeSource(sameDir, 'copy', hebrewCopy);
    let leg = await runLeg({
      label: 'copy',
      mode: 'copy',
      source,
      lecture: 'Import Copy',
      waitMs: guard?.waitMs ?? DONE_TIMEOUT_MS,
    });
    notes.push(describe(leg));
    if (guard) {
      const verdict =
        leg.status === 'done'
          ? 'read without a prompt'
          : leg.status === 'stuck'
            ? 'prompted'
            : 'refused';
      notes.push(`${sameDir}: ${verdict}${leg.code ? ` (code ${leg.code})` : ''}`);
      evidence(
        'manual import: reading the Downloads folder (TCC)',
        `${verdict}${leg.code ? ` — ${leg.code}` : ''}`,
      );
      if (verdict !== 'read without a prompt') {
        if (verdict === 'prompted') await guard.desktop();
        // The import's source read runs off the database's event loop, so a stuck leg times out alone and the database keeps answering.
        sameDir = neutral;
        source = await makeSource(sameDir, 'copy-neutral', hebrewCopy);
        leg = await runLeg({
          label: 'copy-neutral',
          mode: 'copy',
          source,
          lecture: 'Import Copy Neutral',
        });
        notes.push(describe(leg));
        await expectImported(leg, source, 'Import Copy Neutral', { sameVolume: true });
      } else {
        await expectImported(leg, source, 'Import Copy', { sameVolume: true });
      }
    } else {
      await expectImported(leg, source, 'Import Copy', { sameVolume: true });
    }

    // 2. Move on the data root's volume: os.replace in the database.
    source = await makeSource(sameDir, 'move-same');
    leg = await runLeg({
      label: 'move-same-volume',
      mode: 'move',
      source,
      lecture: 'Import Move Same Volume',
    });
    notes.push(describe(leg));
    await expectImported(leg, source, 'Import Move Same Volume', { sameVolume: true });

    // 3. Move from another volume: the copy-then-unlink fallback.
    const other = await otherVolume(paths.workDir());
    dirs.push(other.dir);
    const hebrewLecture = 'הרצאה 7';
    source = await makeSource(other.dir, 'move-other', 'העברה 7 - הקלטה.mp4');
    notes.push(`other volume: ${other.dir}`);
    leg = await runLeg({
      label: 'move-other-volume',
      mode: 'move',
      source,
      lecture: hebrewLecture,
    });
    notes.push(describe(leg));
    await expectImported(leg, source, hebrewLecture, { sameVolume: false });
  } finally {
    evidence('manual import by path', notes.join('\n'));
    await releaseOtherVolume();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export default () => manualImport();
