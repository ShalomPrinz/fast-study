// Recaptures the tour screenshot cards (runner, lecture, editor) as he/en 1008x630 JPEGs from a live harness stack.
//   node frontend/scripts/capture-tour.mjs --harness DIR   (wipes the stack and seeds site/capture/dataset.mjs; see docs/TOUR.md)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(REPO, 'frontend', 'src', 'assets', 'tour')
const TEXT = path.join(REPO, 'site', 'capture', 'text')
const { COURSES, EDITOR, HERO } = await import(
  pathToFileURL(path.join(REPO, 'site', 'capture', 'dataset.mjs')).href
)
const SIZE = { width: 1008, height: 630 }
const QUALITY = 80
const LANGS = ['he', 'en']
// The element each card marks with a ring, since the card's step has no live target to spotlight.
const RING = {
  runner: '[data-tour="runner-run"]',
  lecture: '[data-tour="lecture-pdf"]',
  editor: '.edit-toolbar-actions .btn--primary',
}
// A lecture that stays unfinished, so the runner has a run to show mid-step.
const RUNNING = { course: EDITOR.course, lecture: 'הרצאה 2 — תנאים ולולאות', minutes: 82 }

const harness = process.argv[process.argv.indexOf('--harness') + 1] || process.env.HARNESS_DIR
if (!harness || !fs.existsSync(path.join(harness, 'ports.json'))) {
  console.error(
    'usage: node frontend/scripts/capture-tour.mjs --harness DIR (a live app-harness stack)',
  )
  process.exit(1)
}
process.env.HARNESS_DIR = harness
const ports = JSON.parse(fs.readFileSync(path.join(harness, 'ports.json'), 'utf8'))
const DB = `http://127.0.0.1:${ports.database}`
const BACKEND = `http://127.0.0.1:${ports.backend}`
const PROVIDERS = `http://127.0.0.1:${ports.providers}`
const APP = `http://localhost:${ports.frontend}`
const { installedChromium } = await import(path.join(REPO, '.claude/harness/lib/browser.mjs'))
const { FAKE_COURSE_URL, SCRATCH_MARKER } = await import(
  path.join(REPO, '.claude/harness/lib/env.mjs')
)
const { createRequire } = await import('node:module')
const { chromium } = createRequire(path.join(REPO, 'downloader/auto/package.json'))('playwright')

const q = encodeURIComponent
const lecturePath = (course, lecture) => `/courses/${q(course)}/lectures/${q(lecture)}`
const text = (name, ext) => fs.readFileSync(path.join(TEXT, `${name}.${ext}`))

async function call(method, url, body, type = 'application/json') {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': type },
    body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`)
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text()
}

async function waitFor(what, check, ms = 120_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const fileUrl = (course, lecture, name, kind = 'lecture') =>
  `${DB}${lecturePath(course, lecture)}/files/${q(name)}?kind=${kind}`
const hasFile = (course, lecture, name, kind) =>
  fetch(fileUrl(course, lecture, name, kind), { method: 'HEAD' }).then((r) => r.ok)

// A silent black video of a lecture's length, so the app reads a real duration; cached per length.
function lectureVideo(minutes) {
  const file = path.join(harness, 'site-capture', `${minutes}m.mp4`)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=1'],
      ...['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', String(minutes * 60)],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '3600', '-c:a', 'aac', '-b:a', '8k'],
      ...['-shortest', file],
    ])
  }
  return fs.readFileSync(file)
}

// One step through the backend, as the lecture view's retry button runs it, waiting for its output.
async function runStep(course, lecture, kind, step, output) {
  await fetch(fileUrl(course, lecture, output, kind), { method: 'DELETE' })
  await call('POST', `${BACKEND}${lecturePath(course, lecture)}/run/${step}?kind=${kind}`)
  await waitFor(`${course}/${lecture} ${output}`, () => hasFile(course, lecture, output, kind))
}

// A lecture's files from the dataset, its derived ones rendered by the real PDF and Drive steps.
async function writeLecture(
  course,
  { name, kind = 'lecture', text: slug, minutes, state, studied },
) {
  const at = `${DB}${lecturePath(course, name)}`
  await call('PUT', `${at}/video?kind=${kind}`, lectureVideo(minutes), 'video/mp4')
  if (studied) await call('PUT', `${at}/done?kind=${kind}`)
  if (state === 'video') return
  const audio = fs.readFileSync(path.join(harness, 'fixtures', 'audio.mp3'))
  await call('PUT', `${at}/files/audio.mp3?kind=${kind}`, audio, 'audio/mpeg')
  await call(
    'PUT',
    `${at}/files/transcript.txt?kind=${kind}`,
    text(slug, 'transcript.txt'),
    'text/plain',
  )
  await call(
    'PUT',
    `${at}/summary?kind=${kind}&fresh=true`,
    text(slug, 'summary.md'),
    'text/markdown',
  )
  if (state === 'summarized') return
  await runStep(course, name, kind, 'pdf', 'summary.pdf')
  if (state === 'done') await runStep(course, name, kind, 'drive', 'drive_url.txt')
}

// The app has no route that deletes a course, so the wipe is the one direct write, guarded the way
// the harness guards its own: only a data root carrying the scratch marker.
async function wipe() {
  const { data_root: root } = await call('GET', `${DB}/settings`)
  if (!root || !fs.existsSync(path.join(root, SCRATCH_MARKER)))
    throw new Error(`data root ${root} has no ${SCRATCH_MARKER} marker — refusing to wipe it`)
  for (const entry of fs.readdirSync(root))
    if (entry !== SCRATCH_MARKER) fs.rmSync(path.join(root, entry), { recursive: true })
  await call('POST', `${DB}/notify`)
}

async function prepare() {
  // The harness baseline: settings, the Moodle token, the fakes' modes and a connected fake Drive.
  execFileSync(
    'node',
    [path.join(REPO, '.claude/harness/hb.mjs'), '--harness', harness, 'reseed'],
    {
      stdio: 'inherit',
    },
  )
  await waitFor(
    'the backend to go idle',
    async () => {
      const status = await call('GET', `${BACKEND}/status`)
      return !status.runner.running && !status.queue.length && !status.in_flight.length
    },
    300_000,
  )
  await wipe()
  for (const course of COURSES) {
    await call('POST', `${DB}/courses`, {
      name: course.name,
      ...(course.moodle && { source_url: FAKE_COURSE_URL }),
    })
    for (const lecture of course.lectures) {
      await call(
        'POST',
        `${DB}/courses/${q(course.name)}/lectures?kind=${lecture.kind ?? 'lecture'}`,
        {
          name: lecture.name,
        },
      )
      await writeLecture(course.name, lecture)
    }
  }
  await call('POST', `${DB}/notify`)
  console.log(`seeded ${COURSES.length} courses from site/capture/`)
}

// Timing samples, so the held run's bar shows a time left rather than "not enough data".
async function calibrate(operation, bytes, seconds) {
  for (const scale of [0.8, 0.9, 1.1, 1.2])
    await call('POST', `${BACKEND}/timing`, {
      operation,
      file_size_bytes: Math.round(bytes * scale),
      duration_seconds: seconds * scale,
    })
}

// Holds RUNNING's pipeline mid-transcription on the fake Groq, so /running has a run to show.
async function holdRun() {
  const { course, lecture } = RUNNING
  await call('POST', `${BACKEND}/config`, { auto_run: 'off' })
  await call(
    'PUT',
    `${DB}${lecturePath(course, lecture)}/video`,
    lectureVideo(RUNNING.minutes),
    'video/mp4',
  )
  await call('POST', `${PROVIDERS}/control`, {
    groq: { mode: 'slow', match: `${course}/${lecture}`, ms: 600_000 },
  })
  await call('POST', `${BACKEND}${lecturePath(course, lecture)}/pipeline`)
  await waitFor('the held transcription', async () =>
    (await call('GET', `${BACKEND}/status`)).in_flight.some(
      (run) => run.lecture === lecture && run.step === 'transcribe',
    ),
  )
  const tree = await call('GET', `${DB}/tree`)
  const audio = tree.find((c) => c.name === course).lectures.find((l) => l.name === lecture).files[
    'audio.mp3'
  ].size
  await calibrate('transcribe', audio, 300)
}

async function releaseRun() {
  await call('POST', `${PROVIDERS}/control`, { reset: true })
  await call('POST', `${BACKEND}/config`, { auto_run: 'full' })
}

async function capture() {
  const browser = await chromium.launch({
    executablePath: installedChromium(),
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  })
  for (const lang of LANGS) {
    fs.mkdirSync(path.join(OUT, lang), { recursive: true })
    const context = await browser.newContext({ viewport: SIZE })
    // The tour is dismissed so it does not draw over its own cards; the sidebar's version tag reads
    // "dev" outside the packaged app, where a user sees a release number.
    await context.addInitScript((locale) => {
      localStorage.setItem('fast-study:locale', locale)
      localStorage.setItem('fast-study:tour-dismissed', '1')
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = '.sidebar-version { visibility: hidden; }'
        document.head.append(style)
      })
    }, lang)
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const shot = async (name, route) => {
      await page.goto(APP + route)
      await page.waitForLoadState('networkidle')
      await page.waitForSelector(RING[name])
      if (name === 'editor') await openEditor(page)
      await page.addStyleTag({
        content: `${RING[name]} { outline: 3px solid #4f5bd5; outline-offset: 4px; border-radius: 12px; }`,
      })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(800)
      const file = path.join(OUT, lang, `${name}.jpg`)
      await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY })
      console.log(`captured ${path.relative(REPO, file)} (${fs.statSync(file).size} bytes)`)
    }
    const lectureRoute = (c, l) => `/${q(c)}/${q(l)}`
    await shot('runner', '/running')
    await shot('lecture', lectureRoute(HERO.course, HERO.lecture))
    await shot('editor', `${lectureRoute(EDITOR.course, EDITOR.lecture)}/edit`)
    await context.close()
  }
  await browser.close()
}

// The editor once its PDF has drawn, zoomed out a step so the whole page fits beside the text.
async function openEditor(page) {
  await page.waitForSelector('canvas')
  await page.locator('.pdf-zoom-btn').first().click()
  await page.waitForTimeout(500)
}

await prepare()
await holdRun()
try {
  await capture()
} finally {
  await releaseRun()
}
