// Recaptures the demo video's footage on a live app-harness stack: one still per state of the
// journey in both UI languages, plus each language's manifest of the boxes the camera and cursor target.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JOURNEY,
  REPO,
  call,
  calibrate,
  connect,
  hasFile,
  launchBrowser,
  lecturePath,
  lectureVideo,
  q,
  seedShowcase,
  waitFor,
  writeLecture,
} from '../../.claude/harness/showcase/capture.mjs';
import { pickCourse, recordingCard, showRecording } from '../../.claude/harness/lib/downloads.mjs';

const FOOTAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'footage');
const LANGS = ['he', 'en'];
const SIZE = { width: 1280, height: 800 };
// Captured at 3×; a still the camera never zooms past 2× is stored at 2×.
const SCALE = 3;
// What the video never needs: the language switch, the "no materials" hint on a lecture that has none.
const HIDE = '.language-switcher, .material-indicator { visibility: hidden !important; }';

const { harness, DB, BACKEND, PROVIDERS, SITE, APP } = connect(
  'usage: node site/demo/capture.mjs --harness DIR (a live app-harness stack)',
);
const { course, lecture } = JOURNEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-capture-'));

// One page per language on the same stack; `he` is the one that acts, `en` watches the same server state.
const views = {};
const manifests = {};
for (const lang of LANGS) {
  const { browser, context } = await launchBrowser({
    viewport: SIZE,
    deviceScaleFactor: SCALE,
    locale: lang,
    storage: { 'fast-study:tour-dismissed': '1' },
  });
  await context.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    });
  }, HIDE);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  views[lang] = { browser, page };
  manifests[lang] = { viewport: SIZE, shots: {} };
  fs.rmSync(path.join(FOOTAGE, lang), { recursive: true, force: true });
  fs.rmSync(path.join(FOOTAGE, 'summary.jpg'), { force: true });
  fs.mkdirSync(path.join(FOOTAGE, lang), { recursive: true });
}
const each = (fn) => Promise.all(LANGS.map((lang) => fn(views[lang].page, lang)));

// A still of `clip` (a selector's box, or the whole window) in both languages at once, stored at
// `scale`×, with the CSS-px box of every locator `boxes(page)` names.
async function shot(name, { clip, scale = SCALE, boxes = () => ({}) } = {}) {
  await each(async (page, lang) => {
    const rect = clip
      ? await page
          .locator(clip)
          .first()
          .evaluate((el, size) => {
            const r = el.getBoundingClientRect();
            const x = Math.max(0, Math.round(r.x));
            const y = Math.max(0, Math.round(r.y));
            return {
              x,
              y,
              width: Math.min(size.width, Math.round(r.right)) - x,
              height: Math.min(size.height, Math.round(r.bottom)) - y,
            };
          }, SIZE)
      : { x: 0, y: 0, ...SIZE };
    const found = {};
    for (const [key, locator] of Object.entries(boxes(page))) {
      const box = (await locator.count()) ? await locator.first().boundingBox() : null;
      if (box)
        found[key] = Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)]));
    }
    const png = path.join(tmp, `${lang}-${name}.png`);
    await page.screenshot({ path: png, clip: rect });
    const file = `${name}.jpg`;
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-i', png],
      ...['-vf', `scale=${rect.width * scale}:${rect.height * scale}:flags=lanczos`],
      ...['-q:v', '4', path.join(FOOTAGE, lang, file)],
    ]);
    manifests[lang].shots[name] = { file, rect, boxes: found };
  });
  console.log(`captured ${name}`);
}

const inFlight = async (step) =>
  (await call('GET', `${BACKEND}/status`)).in_flight.some(
    (run) => run.lecture === lecture && run.step === step,
  );

const fileSize = async (name) =>
  (await call('GET', `${DB}/tree`))
    .find((c) => c.name === course)
    .lectures.find((l) => l.name === lecture).files[name].size;

// The lecture page loaded afresh in both languages, so a bar reads the samples just recorded; a load
// the dev server aborts is tried again.
async function reopen() {
  await each(async (page) => {
    const load = () => page.goto(`${APP}/${q(course)}/${q(lecture)}`);
    await load().catch(load);
    await page.waitForSelector('.lecture-pipeline');
    await page.mouse.move(0, 0);
  });
}

// Flow 1: the recording picked on the course's Moodle list and downloaded, its bar shot as it advances.
async function download() {
  await call('POST', `${BACKEND}/config`, { auto_run: 'off' });
  await call('POST', `${SITE}/control`, { downloadMs: 26_000 });
  await calibrate('download:curl', 470_000, 26);
  // One page at a time: the course list is one Moodle call, and auto/ answers a single caller.
  for (const { page } of Object.values(views)) {
    await pickCourse(page, course);
    await page.locator('.downloads-scope-switch .mode-toggle-btn').nth(1).click();
    const row = await showRecording(page, JOURNEY.recording);
    await row.locator('.recording-name-input').fill(lecture);
    await page.evaluate(() => document.querySelector('.recordings-panel').scrollIntoView());
    await page.locator(':focus').blur();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
  }
  const boxes = (page) => {
    const card = recordingCard(page, JOURNEY.recording);
    return {
      card,
      button: card.locator('.recording-download-btn'),
      name: card.locator('.recording-name-input'),
      panel: page.locator('.recordings-panel'),
    };
  };
  const still = (name) => shot(name, { clip: 'main', scale: 2, boxes });
  await shot('downloads-window', { scale: 2, boxes });
  await still('download-0');
  const card = recordingCard(views.he.page, JOURNEY.recording);
  await card.locator('.recording-download-btn').click();
  await views.he.page.mouse.move(0, 0);
  const started = Date.now();
  for (const [i, at] of [1500, 6500, 12_000, 17_500, 23_000].entries()) {
    await sleep(Math.max(0, started + at - Date.now()));
    await still(`download-${i + 1}`);
  }
  await waitFor('the recording', () => hasFile(course, lecture, 'video.mp4'), 60_000);
  await call('POST', `${SITE}/control`, { reset: true });
  await sleep(1500);
  await still('download-done');
}

// Flow 2: the run, each provider step held on its fake so every state is shot once and waiting is cut.
async function pipeline() {
  const at = `${DB}${lecturePath(course, lecture)}`;
  await call('PUT', `${at}/video`, lectureVideo(JOURNEY.minutes), 'video/mp4');
  const match = `${course}/${lecture}`;
  const hold = { mode: 'slow', match, ms: 600_000 };
  await call('POST', `${PROVIDERS}/control`, { groq: hold, gemini: hold });
  await reopen();
  await sleep(1200);
  const boxes = (page) => {
    const rows = page.locator('.lecture-pipeline .pipeline-row');
    return {
      steps: page.locator('.lecture-pipeline'),
      video: rows.nth(0),
      audio: rows.nth(1),
      transcribe: rows.nth(2),
      summarize: rows.nth(3),
      pdf: rows.nth(4),
      drive: rows.nth(5),
      header: page.locator('.page-header'),
      column: page.locator('.lecture-page'),
    };
  };
  const still = (name) => shot(name, { clip: 'main', boxes });
  await shot('lecture-window', { scale: 2, boxes });
  await still('pipeline-idle');

  // The bars of the held steps run on these samples, short enough to advance between two stills.
  const video = fs.statSync(path.join(harness, 'showcase', `${JOURNEY.minutes}m.mp4`)).size;
  await calibrate('audio', video, 8);
  await call('POST', `${BACKEND}${lecturePath(course, lecture)}/pipeline`);
  await sleep(700);
  await still('pipeline-audio');
  await waitFor('the transcription', () => inFlight('transcribe'));
  await calibrate('transcribe', await fileSize('audio.mp3'), 14);
  await reopen();
  await sleep(2500);
  await still('pipeline-transcribe-1');
  await sleep(5500);
  await still('pipeline-transcribe-2');

  await call('POST', `${PROVIDERS}/control`, { groq: 'ok', gemini: hold });
  // The lecture-length audio is hundreds of chunks, each its own call to the fake.
  await waitFor('the summary step', () => inFlight('summarize'), 600_000);
  await calibrate('summarize', await fileSize('transcript.txt'), 18);
  await reopen();
  await sleep(2500);
  await still('pipeline-summarize-1');
  await sleep(5500);
  await still('pipeline-summarize-2');

  await call('POST', `${PROVIDERS}/control`, { reset: true });
  await waitFor('the PDF step', () => inFlight('pdf'), 60_000);
  await sleep(300);
  await still('pipeline-pdf');
  await waitFor('the pipeline', () => hasFile(course, lecture, 'drive_url.txt'), 300_000);
}

// Flows 3 and 4: the finished lecture with its dataset text — the PDF preview, the Drive control —
// and the PDF's own first pages as one clean sheet.
async function finished() {
  await writeLecture(course, { name: lecture, ...JOURNEY, state: 'done' });
  await reopen();
  await each((page) => page.waitForSelector('.pdf-thumbnail canvas'));
  await sleep(1500);
  const boxes = (page) => ({
    steps: page.locator('.lecture-pipeline'),
    pdf: page.locator('.lecture-split-pdf'),
    openPdf: page.locator('.pdf-hero-link'),
    actions: page.locator('.page-header-secondary'),
    drive: page.locator('.page-header-secondary .header-action').last(),
    state: page.locator('.page-header-state'),
    header: page.locator('.page-header'),
    column: page.locator('.lecture-page'),
  });
  await shot('finished-window', { scale: 2, boxes });
  await shot('finished', { clip: 'main', boxes });

  const pdf = path.join(harness, 'data', course, lecture, 'summary.pdf');
  // The first page's text with a margin and without its page number, wide enough to fill the video's frame at 1:1.
  const script = [
    'import fitz, json, sys',
    'page = fitz.open(sys.argv[1])[0]',
    'box = fitz.Rect()',
    'foot = page.rect.height * 0.9',
    'for b in page.get_text("blocks"):',
    '    if b[1] < foot: box |= fitz.Rect(b[:4])',
    'pad = 36',
    'clip = fitz.Rect(box.x0 - pad, box.y0 - pad, box.x1 + pad, box.y1 + pad) & page.rect',
    'zoom = 1900 / clip.width',
    'pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip)',
    'pix.save(sys.argv[2], jpg_quality=80)',
    'print(json.dumps({"width": pix.width, "height": pix.height}))',
  ].join('\n');
  const size = execFileSync(
    'uv',
    ['run', '--extra', 'test', 'python', '-c', script, pdf, path.join(FOOTAGE, 'summary.jpg')],
    { cwd: path.join(REPO, 'backend'), encoding: 'utf8' },
  );
  for (const lang of LANGS)
    manifests[lang].sheet = { file: 'summary.jpg', ...JSON.parse(size.trim().split('\n').pop()) };
  console.log('captured the summary PDF');
}

try {
  await seedShowcase();
  // The helper server remembers its finished jobs, and a rerun would open on a row that reads downloaded.
  execFileSync(
    'node',
    [
      path.join(REPO, '.claude/harness/setup.mjs'),
      '--harness',
      harness,
      '--restart',
      'downloader-server',
    ],
    { stdio: 'inherit' },
  );
  await download();
  await pipeline();
  await finished();
  for (const lang of LANGS)
    fs.writeFileSync(
      path.join(FOOTAGE, lang, 'manifest.json'),
      `${JSON.stringify(manifests[lang], null, 2)}\n`,
    );
} finally {
  await call('POST', `${PROVIDERS}/control`, { reset: true }).catch(() => {});
  await call('POST', `${SITE}/control`, { reset: true }).catch(() => {});
  for (const lang of LANGS) await views[lang].browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
