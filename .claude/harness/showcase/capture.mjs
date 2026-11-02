/* global document -- the init script runs in the page */
// Shared by the screenshot scripts (site/capture.mjs, frontend/scripts/capture-tour.mjs): they drive a live stack and seed the showcase dataset.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedChromium } from '../lib/browser.mjs';
import { FAKE_COURSE_URL, SCRATCH_MARKER } from '../lib/env.mjs';
import { COURSES } from './dataset.mjs';

export * from './dataset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
const TEXT = path.join(HERE, 'text');

export const q = encodeURIComponent;
export const lecturePath = (course, lecture) => `/courses/${q(course)}/lectures/${q(lecture)}`;
const text = (name, ext) => fs.readFileSync(path.join(TEXT, `${name}.${ext}`));

// Set by connect(); every helper below reads the stack from it.
export let env;

// Reads --harness DIR / HARNESS_DIR, exits with `usage` when no live stack is there, returns the stack's URLs.
export function connect(usage) {
  const flag = process.argv.indexOf('--harness');
  const harness = (flag >= 0 && process.argv[flag + 1]) || process.env.HARNESS_DIR;
  if (!harness || !fs.existsSync(path.join(harness, 'ports.json'))) {
    console.error(usage);
    process.exit(1);
  }
  process.env.HARNESS_DIR = harness;
  const ports = JSON.parse(fs.readFileSync(path.join(harness, 'ports.json'), 'utf8'));
  env = {
    harness,
    DB: `http://127.0.0.1:${ports.database}`,
    BACKEND: `http://127.0.0.1:${ports.backend}`,
    PROVIDERS: `http://127.0.0.1:${ports.providers}`,
    SITE: `http://127.0.0.1:${ports.site}`,
    APP: `http://localhost:${ports.frontend}`,
  };
  return env;
}

export async function call(method, url, body, type = 'application/json') {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': type },
    body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

export async function waitFor(what, check, ms = 120_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const fileUrl = (course, lecture, name, kind = 'lecture') =>
  `${env.DB}${lecturePath(course, lecture)}/files/${q(name)}?kind=${kind}`;
export const hasFile = (course, lecture, name, kind) =>
  fetch(fileUrl(course, lecture, name, kind), { method: 'HEAD' }).then((r) => r.ok);

// A silent black video of a lecture's length, so the app reads a real duration; cached per length.
export function lectureVideo(minutes) {
  const file = path.join(env.harness, 'showcase', `${minutes}m.mp4`);
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
export async function runStep(course, lecture, kind, step, output) {
  await fetch(fileUrl(course, lecture, output, kind), { method: 'DELETE' });
  await call('POST', `${env.BACKEND}${lecturePath(course, lecture)}/run/${step}?kind=${kind}`);
  await waitFor(`${course}/${lecture} ${output}`, () => hasFile(course, lecture, output, kind));
}

// A lecture's files from the dataset, its derived ones rendered by the real PDF and Drive steps.
export async function writeLecture(
  course,
  { name, kind = 'lecture', text: slug, minutes, state, studied },
) {
  const at = `${env.DB}${lecturePath(course, name)}`;
  await call('PUT', `${at}/video?kind=${kind}`, lectureVideo(minutes), 'video/mp4');
  if (studied) await call('PUT', `${at}/done?kind=${kind}`);
  if (state === 'video') return;
  const audio = fs.readFileSync(path.join(env.harness, 'fixtures', 'audio.mp3'));
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
export async function wipe() {
  const { data_root: root } = await call('GET', `${env.DB}/settings`);
  if (!root || !fs.existsSync(path.join(root, SCRATCH_MARKER)))
    throw new Error(`data root ${root} has no ${SCRATCH_MARKER} marker — refusing to wipe it`);
  for (const entry of fs.readdirSync(root))
    if (entry !== SCRATCH_MARKER) fs.rmSync(path.join(root, entry), { recursive: true });
  await call('POST', `${env.DB}/notify`);
}

// Resets the stack to the harness baseline, then replaces its data with the showcase COURSES.
export async function seedShowcase() {
  execFileSync('node', [path.join(HERE, '..', 'hb.mjs'), '--harness', env.harness, 'reseed'], {
    stdio: 'inherit',
  });
  // A run an interrupted capture left behind would hold a lecture's buttons.
  await waitFor(
    'the backend to go idle',
    async () => {
      const status = await call('GET', `${env.BACKEND}/status`);
      return !status.runner.running && !status.queue.length && !status.in_flight.length;
    },
    300_000,
  );
  await wipe();
  for (const course of COURSES) {
    await call('POST', `${env.DB}/courses`, {
      name: course.name,
      ...(course.moodle && { source_url: FAKE_COURSE_URL }),
    });
    for (const lecture of course.lectures) {
      await call(
        'POST',
        `${env.DB}/courses/${q(course.name)}/lectures?kind=${lecture.kind ?? 'lecture'}`,
        { name: lecture.name },
      );
      await writeLecture(course.name, lecture);
    }
  }
  await call('POST', `${env.DB}/notify`);
  console.log(`seeded ${COURSES.length} courses from .claude/harness/showcase/`);
}

// Timing samples, so a held step's or download's bar shows a time left rather than "not enough data".
export async function calibrate(operation, bytes, seconds) {
  for (const scale of [0.8, 0.9, 1.1, 1.2])
    await call('POST', `${env.BACKEND}/timing`, {
      operation,
      file_size_bytes: Math.round(bytes * scale),
      duration_seconds: seconds * scale,
    });
}

// The editor once its PDF has drawn, zoomed out a step so the whole page fits beside the text.
export async function openEditor(page) {
  await page.waitForSelector('canvas');
  await page.locator('.pdf-zoom-btn').first().click();
  await page.waitForTimeout(500);
}

// Chromium cut off from the internet, one context with the locale and `storage` entries preset.
export async function launchBrowser({ viewport, deviceScaleFactor, locale, storage = {} }) {
  const { chromium } = createRequire(path.join(REPO, 'downloader/auto/package.json'))('playwright');
  const browser = await chromium.launch({
    executablePath: installedChromium(),
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  // The sidebar's version tag reads "dev" outside the packaged app, where a user sees a release number.
  await context.addInitScript(
    (entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.sidebar-version { visibility: hidden; }';
        document.head.append(style);
      });
    },
    { 'fast-study:locale': locale, ...storage },
  );
  return { browser, context };
}
