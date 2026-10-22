// Recaptures the page's eleven app screenshots from a live app-harness stack, in Hebrew, 1280×800 JPEG.
//   node site/capture.mjs --harness DIR      (the stack must be up: node .claude/harness/setup.mjs --harness DIR)
// It wipes that stack's data and writes the site's own dataset (site/capture/) in its place.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSES, EDITOR, HERO, JOURNEY, OVERVIEW, SEARCH } from './capture/dataset.mjs';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SITE, '..');
const IMG = path.join(SITE, 'img');
const TEXT = path.join(SITE, 'capture', 'text');
const SIZE = { width: 1280, height: 800 };

const harness = process.argv[process.argv.indexOf('--harness') + 1] || process.env.HARNESS_DIR;
if (!harness || !fs.existsSync(path.join(harness, 'ports.json'))) {
  console.error('usage: node site/capture.mjs --harness DIR (a live app-harness stack)');
  process.exit(1);
}
process.env.HARNESS_DIR = harness;
const ports = JSON.parse(fs.readFileSync(path.join(harness, 'ports.json'), 'utf8'));
const DB = `http://127.0.0.1:${ports.database}`;
const BACKEND = `http://127.0.0.1:${ports.backend}`;
const PROVIDERS = `http://127.0.0.1:${ports.providers}`;
const SITE_FAKE = `http://127.0.0.1:${ports.site}`;
const APP = `http://localhost:${ports.frontend}`;
const { installedChromium } = await import(path.join(REPO, '.claude/harness/lib/browser.mjs'));
const { FAKE_COURSE_URL, SCRATCH_MARKER } = await import(
  path.join(REPO, '.claude/harness/lib/env.mjs')
);
const { createRequire } = await import('node:module');
const { chromium } = createRequire(path.join(REPO, 'downloader/auto/package.json'))('playwright');

const q = encodeURIComponent;
const lecturePath = (course, lecture) => `/courses/${q(course)}/lectures/${q(lecture)}`;
const text = (name, ext) => fs.readFileSync(path.join(TEXT, `${name}.${ext}`));

async function call(method, url, body, type = 'application/json') {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': type },
    body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

async function waitFor(what, check, ms = 120_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const fileUrl = (course, lecture, name, kind = 'lecture') =>
  `${DB}${lecturePath(course, lecture)}/files/${q(name)}?kind=${kind}`;
const hasFile = (course, lecture, name, kind) =>
  fetch(fileUrl(course, lecture, name, kind), { method: 'HEAD' }).then((r) => r.ok);

// A silent black video of a lecture's length, so the app reads a real duration; cached per length.
function lectureVideo(minutes) {
  const file = path.join(harness, 'site-capture', `${minutes}m.mp4`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=1'],
      ...['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', String(minutes * 60)],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '3600', '-c:a', 'aac', '-b:a', '8k'],
      ...['-shortest', file],
    ]);
  }
  return fs.readFileSync(file);
}

// One step through the backend, as the lecture view's retry button runs it, waiting for its output.
async function runStep(course, lecture, kind, step, output) {
  await fetch(fileUrl(course, lecture, output, kind), { method: 'DELETE' });
  await call('POST', `${BACKEND}${lecturePath(course, lecture)}/run/${step}?kind=${kind}`);
  await waitFor(`${course}/${lecture} ${output}`, () => hasFile(course, lecture, output, kind));
}

// A lecture's files from the dataset, its derived ones rendered by the real PDF and Drive steps.
async function writeLecture(
  course,
  { name, kind = 'lecture', text: slug, minutes, state, studied },
) {
  const at = `${DB}${lecturePath(course, name)}`;
  await call('PUT', `${at}/video?kind=${kind}`, lectureVideo(minutes), 'video/mp4');
  if (studied) await call('PUT', `${at}/done?kind=${kind}`);
  if (state === 'video') return;
  const audio = fs.readFileSync(path.join(harness, 'fixtures', 'audio.mp3'));
  await call('PUT', `${at}/files/audio.mp3?kind=${kind}`, audio, 'audio/mpeg');
  await call(
    'PUT',
    `${at}/files/transcript.txt?kind=${kind}`,
    text(slug, 'transcript.txt'),
    'text/plain',
  );
  await call(
    'PUT',
    `${at}/summary?kind=${kind}&fresh=true`,
    text(slug, 'summary.md'),
    'text/markdown',
  );
  if (state === 'summarized') return;
  await runStep(course, name, kind, 'pdf', 'summary.pdf');
  if (state === 'done') await runStep(course, name, kind, 'drive', 'drive_url.txt');
}

// The app has no route that deletes a course, so the wipe is the one direct write, guarded the way
// the harness guards its own: only a data root carrying the scratch marker.
async function wipe() {
  const { data_root: root } = await call('GET', `${DB}/settings`);
  if (!root || !fs.existsSync(path.join(root, SCRATCH_MARKER)))
    throw new Error(`data root ${root} has no ${SCRATCH_MARKER} marker — refusing to wipe it`);
  for (const entry of fs.readdirSync(root))
    if (entry !== SCRATCH_MARKER) fs.rmSync(path.join(root, entry), { recursive: true });
  await call('POST', `${DB}/notify`);
}

async function prepare() {
  // The harness baseline: settings, the Moodle token, the fakes' modes and a connected fake Drive.
  execFileSync(
    'node',
    [path.join(REPO, '.claude/harness/hb.mjs'), '--harness', harness, 'reseed'],
    {
      stdio: 'inherit',
    },
  );
  // A run an interrupted capture left behind would hold the journey lecture's download button.
  await waitFor(
    'the backend to go idle',
    async () => {
      const status = await call('GET', `${BACKEND}/status`);
      return !status.runner.running && !status.queue.length && !status.in_flight.length;
    },
    300_000,
  );
  await wipe();
  for (const course of COURSES) {
    await call('POST', `${DB}/courses`, {
      name: course.name,
      ...(course.moodle && { source_url: FAKE_COURSE_URL }),
    });
    for (const lecture of course.lectures) {
      await call(
        'POST',
        `${DB}/courses/${q(course.name)}/lectures?kind=${lecture.kind ?? 'lecture'}`,
        {
          name: lecture.name,
        },
      );
      await writeLecture(course.name, lecture);
    }
  }
  await call('POST', `${DB}/notify`);
  console.log(`seeded ${COURSES.length} courses from site/capture/`);

  await call('POST', `${BACKEND}/courses/${q(OVERVIEW)}/overview/generate`);
  await new Promise((r) => setTimeout(r, 1000));
  await waitFor(
    'the overview',
    async () => !(await call('GET', `${BACKEND}/courses/${q(OVERVIEW)}/overview/status`)).running,
  );
}

// The summary card shows the PDF itself: the text of its first page, margins trimmed, cropped to 16:10.
function summaryPdfShot() {
  const pdf = path.join(harness, 'data', HERO.course, HERO.lecture, 'summary.pdf');
  const script = [
    'import fitz, sys',
    'page = fitz.open(sys.argv[1])[0]',
    'box = fitz.Rect()',
    'for b in page.get_text("blocks"): box |= fitz.Rect(b[:4])',
    'pad = 28',
    'width = box.width + 2 * pad',
    'clip = fitz.Rect(box.x0 - pad, box.y0 - pad, box.x1 + pad, box.y0 - pad + width * 10 / 16)',
    'zoom = 1280 / width',
    'page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip).save(sys.argv[2], jpg_quality=80)',
  ].join('\n');
  execFileSync('uv', ['run', 'python', '-c', script, pdf, path.join(IMG, 'feature-summary.jpg')], {
    cwd: path.join(REPO, 'backend'),
    stdio: 'inherit',
  });
  console.log('captured feature-summary.jpg');
}

async function capture() {
  const browser = await chromium.launch({
    executablePath: installedChromium(),
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  });
  const context = await browser.newContext({ viewport: SIZE });
  // The sidebar's version tag reads "dev" outside the packaged app, where a user sees a release number.
  await context.addInitScript(() => {
    localStorage.setItem('fast-study:locale', 'he');
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.sidebar-version { visibility: hidden; }';
      document.head.append(style);
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  const shot = async (name) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(IMG, `${name}.jpg`), type: 'jpeg', quality: 80 });
    console.log(`captured ${name}.jpg`);
  };
  const open = async (route) => {
    await page.goto(APP + route);
    await page.waitForLoadState('networkidle');
  };
  const lectureRoute = (course, lecture) => `/${q(course)}/${q(lecture)}`;

  await open(lectureRoute(HERO.course, HERO.lecture));
  await shot('hero');

  await open(`/course/${q(OVERVIEW)}/overview`);
  await shot('feature-overview');

  await open(`${lectureRoute(EDITOR.course, EDITOR.lecture)}/edit`);
  await openEditor(page);
  await shot('feature-editor');

  await open('/search');
  await page.selectOption('.search-course-select', { label: SEARCH.course });
  await page.fill('.search-input', SEARCH.query);
  await shot('feature-search');

  // The harness baseline turns the daily run off; the shot shows the app's default, on, unsaved.
  await open('/settings');
  const daily = page.getByLabel('להריץ מדי יום הרצאות שלא הסתיימו');
  if (!(await daily.isChecked())) await daily.check();
  await page.evaluate(() =>
    document.getElementById('auto-run').scrollIntoView({ block: 'center' }),
  );
  await shot('feature-auto');

  await journey(page, open, shot, lectureRoute);
  await browser.close();
}

// Timing samples, sent as the pipeline records its own, so the held step's bar shows a remaining
// time rather than "taking longer than expected" against the fakes' one-second runs.
async function calibrate(operation, bytes, seconds) {
  for (const scale of [0.8, 0.9, 1.1, 1.2])
    await call('POST', `${BACKEND}/timing`, {
      operation,
      file_size_bytes: Math.round(bytes * scale),
      duration_seconds: seconds * scale,
    });
}

// The journey: the recording downloaded from the course's Moodle page, its pipeline held mid-step on
// the fake Groq, then the finished lecture given its dataset text and opened in the editor.
async function journey(page, open, shot, lectureRoute) {
  const { course, lecture } = JOURNEY;
  // The fake site serves a 20-second clip; the run starts by hand once a lecture-length video replaces it.
  await call('POST', `${BACKEND}/config`, { auto_run: 'off' });
  await call('POST', `${SITE_FAKE}/control`, { downloadMs: 30_000 });
  await open('/downloads');
  await page.click('text=טעינת הקלטות');
  const row = page.locator('.recording-card', { hasText: JOURNEY.recording });
  await row.locator('.recording-name-input').fill(lecture);
  await row.locator('.recording-download-btn').click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.querySelector('.recordings-panel').scrollIntoView());
  await shot('journey-download');
  await page.click('.recording-playlist [aria-controls]');
  await page.waitForSelector('.recording-playlist .recording-children .recording-card');
  await page.evaluate(() =>
    document.querySelector('.recording-playlist').scrollIntoView({ block: 'center' }),
  );
  await shot('feature-download');
  await call('POST', `${SITE_FAKE}/control`, { reset: true });
  await waitFor('the recording', () => hasFile(course, lecture, 'video.mp4'), 60_000);

  const at = `${DB}${lecturePath(course, lecture)}`;
  await call('PUT', `${at}/video`, lectureVideo(JOURNEY.minutes), 'video/mp4');
  await call('POST', `${PROVIDERS}/control`, {
    groq: { mode: 'slow', match: `${course}/${lecture}`, ms: 600_000 },
  });
  await call('POST', `${BACKEND}${lecturePath(course, lecture)}/pipeline`);
  await waitFor('the journey transcription', async () =>
    (await call('GET', `${BACKEND}/status`)).in_flight.some(
      (run) => run.lecture === lecture && run.step === 'transcribe',
    ),
  );
  const tree = await call('GET', `${DB}/tree`);
  const audio = tree.find((c) => c.name === course).lectures.find((l) => l.name === lecture).files[
    'audio.mp3'
  ].size;
  await calibrate('transcribe', audio, 300);
  await open(lectureRoute(course, lecture));
  await page.waitForTimeout(5000);
  await shot('journey-progress');

  // A new rule ends the held calls, and the pipeline runs on to Drive.
  await call('POST', `${PROVIDERS}/control`, { reset: true });
  await waitFor('the journey pipeline', () => hasFile(course, lecture, 'drive_url.txt'), 300_000);
  await call('POST', `${BACKEND}/config`, { auto_run: 'full' });
  await writeLecture(course, { name: lecture, ...JOURNEY, state: 'done' });

  await open(lectureRoute(course, lecture));
  await shot('journey-summary');

  await open(`${lectureRoute(course, lecture)}/edit`);
  await openEditor(page);
  // An edit in progress: a new bullet under the lesson's goals (Enter continues the list), so the
  // save button reads live.
  await page.locator('.cm-line', { hasText: 'ומסלולים קצרים ביותר' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('תרגיל: BFS על מפת הקמפוס');
  await shot('journey-edit');
}

// The editor once its PDF has drawn, zoomed out a step so the whole page fits beside the text.
async function openEditor(page) {
  await page.waitForSelector('canvas');
  await page.locator('.pdf-zoom-btn').first().click();
  await page.waitForTimeout(500);
}

await prepare();
summaryPdfShot();
await capture();
