import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDITOR,
  HERO,
  JOURNEY,
  OVERVIEW,
  REPO,
  SEARCH,
  call,
  calibrate,
  connect,
  hasFile,
  launchBrowser,
  lecturePath,
  lectureVideo,
  openEditor,
  q,
  seedShowcase,
  waitFor,
  writeLecture,
} from '../.claude/harness/showcase/capture.mjs';
import { pickCourse, showRecording } from '../.claude/harness/lib/downloads.mjs';

const IMG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'img');
const SIZE = { width: 1280, height: 800 };
const SCALE = 2;
const QUALITY = 85;

const { harness, DB, BACKEND, PROVIDERS, SITE, APP } = connect(
  'usage: node site/capture.mjs --harness DIR (a live app-harness stack)',
);

async function prepare() {
  await seedShowcase();
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
    `zoom = ${SIZE.width * SCALE} / width`,
    `page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip).save(sys.argv[2], jpg_quality=${QUALITY})`,
  ].join('\n');
  execFileSync(
    'uv',
    ['run', '--extra', 'test', 'python', '-c', script, pdf, path.join(IMG, 'feature-summary.jpg')],
    {
      cwd: path.join(REPO, 'backend'),
      stdio: 'inherit',
    },
  );
  console.log('captured feature-summary.jpg');
}

async function capture() {
  const { browser, context } = await launchBrowser({
    viewport: SIZE,
    deviceScaleFactor: SCALE,
    locale: 'he',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  const shot = async (name) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(IMG, `${name}.jpg`), type: 'jpeg', quality: QUALITY });
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

  await open('/settings');
  await page.evaluate(() =>
    document.getElementById('auto-run').scrollIntoView({ block: 'center' }),
  );
  await shot('feature-auto');

  await journey(page, open, shot, lectureRoute);

  await open('/search');
  await page.selectOption('.search-course-select', { label: SEARCH.course });
  await page.fill('.search-input', SEARCH.query);
  await shot('feature-search');
  await browser.close();
}

// The journey: the recording downloaded from the course's Moodle page, its pipeline held mid-step on
// the fake Groq, then the finished lecture given its dataset text and opened in the editor.
async function journey(page, open, shot, lectureRoute) {
  const { course, lecture } = JOURNEY;
  // The fake site serves a 20-second clip; the run starts by hand once a lecture-length video replaces it.
  await call('POST', `${BACKEND}/config`, { auto_run: 'off' });
  await call('POST', `${SITE}/control`, { downloadMs: 30_000 });
  // Samples for the download's own bar (a curl download), so it shows time left, not "not enough data".
  await calibrate('download:curl', 470_000, 30);
  // Picking the course in the bar loads it; the panel opens on New, so switch to All, the per-card list.
  await pickCourse(page, course);
  await page.locator('.downloads-scope-switch .mode-toggle-btn').nth(1).click();
  const row = await showRecording(page, JOURNEY.recording);
  await row.locator('.recording-name-input').fill(lecture);
  await row.locator('.recording-download-btn').click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.querySelector('.recordings-panel').scrollIntoView());
  await shot('journey-download');
  await page.click('.recording-playlist [aria-controls]');
  await page.waitForSelector('.recording-playlist .recording-children .recording-card');
  // The page's header is a fixed panel above the scrolling body; put the cards just below it.
  await page.evaluate(() => {
    const scroller = (function up(e) {
      for (; e; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight && /auto|scroll/.test(getComputedStyle(e).overflowY))
          return e;
      return document.scrollingElement;
    })(document.querySelector('.recordings-panel'));
    const cards = document.querySelector('.recordings-panel .mode-toggle--cards');
    // The document scroller's rect top is -scrollY, so its viewport top is 0.
    const scrollerTop =
      scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    const delta = cards.getBoundingClientRect().top - scrollerTop - 16;
    scroller.scrollBy({ top: delta, behavior: 'instant' });
  });
  await shot('feature-download');
  await call('POST', `${SITE}/control`, { reset: true });
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
  // Auto-run stays off until the files are written, or it would race the dataset's own steps.
  await writeLecture(course, { name: lecture, ...JOURNEY, state: 'done' });
  await call('POST', `${BACKEND}/config`, { auto_run: 'full' });

  await open(lectureRoute(course, lecture));
  await shot('journey-summary');

  await open(`${lectureRoute(course, lecture)}/edit`);
  await openEditor(page);
  // An edit in progress: a new bullet under the lesson's goals (Enter continues the list), so the
  // save button reads live.
  await page.locator('.cm-line', { hasText: 'חיפוש לרוחב וחיפוש לעומק' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('תרגיל: מתי רשימת שכנויות עדיפה על מטריצה');
  await shot('journey-edit');
}

await prepare();
summaryPdfShot();
await capture();
