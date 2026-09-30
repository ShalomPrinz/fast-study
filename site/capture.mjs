// Recaptures the page's seven app screenshots from a live app-harness stack, in Hebrew, 1280×800 JPEG.
//   node site/capture.mjs --harness DIR      (the stack must be up: node .claude/harness/setup.mjs --harness DIR)
// It reseeds that stack first, then renames the hb-* fixture courses to real-looking ones.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SITE, '..');
const IMG = path.join(SITE, 'img');
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
const SITE_FAKE = `http://127.0.0.1:${ports.site}`;
const APP = `http://localhost:${ports.frontend}`;
const { installedChromium } = await import(path.join(REPO, '.claude/harness/lib/browser.mjs'));
const { createRequire } = await import('node:module');
const { chromium } = createRequire(path.join(REPO, 'downloader/auto/package.json'))('playwright');

const COURSES = {
  'hb-nav': 'מבני נתונים',
  'hb-edit': 'מבוא למדעי המחשב',
  'hb-pipeline': 'אלגוריתמים',
  'hb-dl': 'חשבון אינפיניטסימלי 1',
};
// The overview's pattern extractors need a lecturer's asides, which the fixture transcript lacks.
const ASIDES = `
תזכרו את זה, במבחן תמיד יש שאלה על חיפוש בינארי במערך ממוין.
יש שאלה מאחור? כן. שאלה טובה: מה קורה כשהמערך לא ממוין? אז חיפוש בינארי פשוט לא עובד, וצריך קודם למיין.
שימו לב, טעות נפוצה היא לחשוב שמיון מהיר תמיד מהיר יותר ממיון מיזוג. במקרה הגרוע הוא ריבועי.
`;

const q = encodeURIComponent;
const lecturePath = (course, lecture) => `/courses/${q(course)}/lectures/${q(lecture)}`;

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

async function waitFor(what, check, ms = 60_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const hasFile = (course, lecture, name) =>
  fetch(`${DB}${lecturePath(course, lecture)}/files/${name}?kind=lecture`, { method: 'HEAD' }).then(
    (r) => r.ok,
  );

async function renderPdf(course, lecture) {
  await fetch(`${DB}${lecturePath(course, lecture)}/files/summary.pdf?kind=lecture`, {
    method: 'DELETE',
  });
  await call('POST', `${BACKEND}${lecturePath(course, lecture)}/run/pdf?kind=lecture`);
  await waitFor(`${course}/${lecture} summary.pdf`, () => hasFile(course, lecture, 'summary.pdf'));
}

async function prepare() {
  execFileSync(
    'node',
    [path.join(REPO, '.claude/harness/hb.mjs'), '--harness', harness, 'reseed'],
    {
      stdio: 'inherit',
    },
  );
  for (const c of ['hb-mgmt', 'hb-selfcheck', 'hb-fail'])
    await call('PATCH', `${DB}/courses/${c}/archived`, { archived: true });
  await call('PATCH', `${DB}${lecturePath('hb-edit', 'Lecture 3')}?kind=lecture`, {
    name: 'שיעור 3',
  });
  for (const [from, to] of Object.entries(COURSES))
    await call('PATCH', `${DB}/courses/${q(from)}`, { name: to });
  await call('POST', `${DB}/notify`);

  // The hero lecture complete with a real rendered PDF, and the editor's lecture with one to show.
  const hero = ['מבני נתונים', 'שיעור 1'];
  await call('POST', `${BACKEND}${lecturePath(...hero)}/run/audio?kind=lecture`);
  await waitFor('hero audio.mp3', () => hasFile(...hero, 'audio.mp3'));
  await renderPdf(...hero);
  await renderPdf('מבוא למדעי המחשב', 'שיעור 1');

  const transcript = `${DB}${lecturePath('אלגוריתמים', 'שיעור 2')}/files/transcript.txt?kind=lecture`;
  await call('PUT', transcript, (await call('GET', transcript)) + ASIDES);
  await call('POST', `${BACKEND}/courses/${q('אלגוריתמים')}/overview/generate`);
  const overviewDone = async () =>
    !(await call('GET', `${BACKEND}/courses/${q('אלגוריתמים')}/overview/status`)).running;
  await new Promise((r) => setTimeout(r, 1000));
  await waitFor('the overview', overviewDone, 120_000);
}

// The summary card shows the PDF itself: the text of its first page, margins trimmed, cropped to 16:10.
function summaryPdfShot() {
  const pdf = path.join(harness, 'data', 'מבני נתונים', 'שיעור 1', 'summary.pdf');
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
}

async function capture() {
  const browser = await chromium.launch({
    executablePath: installedChromium(),
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  });
  const page = await (await browser.newContext({ viewport: SIZE })).newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(APP);
  await page.evaluate(() => localStorage.setItem('fast-study:locale', 'he'));

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

  await open(`/${q('מבני נתונים')}/${q('שיעור 1')}`);
  await shot('hero');

  // A download held in flight, beside one already in the course.
  await call('POST', `${SITE_FAKE}/control`, { downloadMs: 120_000 });
  await open('/downloads');
  await page.click('text=טעינת הקלטות');
  await page.click('.recording-caret');
  await page.click('.recording-download-btn');
  // A lecture a previous capture downloaded asks before overwriting.
  await page.click('.modal-actions .btn--primary', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.evaluate(() => document.querySelector('.recordings-panel').scrollIntoView());
  await shot('feature-download');
  await call('POST', `${SITE_FAKE}/control`, { reset: true });

  await open(`/course/${q('אלגוריתמים')}/overview`);
  await shot('feature-overview');

  await open(`/${q('מבוא למדעי המחשב')}/${q('שיעור 1')}/edit`);
  await page.waitForSelector('canvas');
  await shot('feature-editor');

  await open('/search');
  await page.selectOption('.search-course-select', { label: 'מבני נתונים' });
  await page.fill('.search-input', 'חיפוש בינארי');
  await shot('feature-search');

  // The harness baseline turns the daily run off; the shot shows the app's default, on, unsaved.
  await open('/settings');
  const daily = page.getByLabel('להריץ מדי יום הרצאות שלא הסתיימו');
  if (!(await daily.isChecked())) await daily.check();
  await page.evaluate(() =>
    document.getElementById('auto-run').scrollIntoView({ block: 'center' }),
  );
  await shot('feature-auto');

  await browser.close();
}

await prepare();
summaryPdfShot();
await capture();
