// Recaptures the tour screenshot cards (downloads, runner, lecture) as he/en 1008x630 JPEGs from a live harness stack.
//   node frontend/scripts/capture-tour.mjs --harness DIR   (wipes the stack and seeds the showcase dataset; see docs/TOUR.md)
import fs from 'node:fs'
import path from 'node:path'
import {
  HERO,
  REPO,
  calibrate,
  call,
  connect,
  launchBrowser,
  lecturePath,
  lectureVideo,
  q,
  seedShowcase,
  waitFor,
} from '../../.claude/harness/showcase/capture.mjs'

const OUT = path.join(REPO, 'frontend', 'src', 'assets', 'tour')
const SIZE = { width: 1008, height: 630 }
const QUALITY = 80
const LANGS = ['he', 'en']
// The element each slide's screenshot marks with a ring.
const RING = {
  downloads: '.downloads-tabs',
  runner: '.focus-card',
  lecture: '.lecture-split-pdf',
}
// A lecture that stays unfinished, so the runner has a run to show mid-step.
const RUNNING = { course: 'מבוא למדעי המחשב', lecture: 'הרצאה 2 — תנאים ולולאות', minutes: 82 }

const { DB, BACKEND, PROVIDERS, APP } = connect(
  'usage: node frontend/scripts/capture-tour.mjs --harness DIR (a live app-harness stack)',
)

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
  for (const lang of LANGS) {
    fs.mkdirSync(path.join(OUT, lang), { recursive: true })
    // The tour is marked seen so it does not draw over its own screenshots.
    const { browser, context } = await launchBrowser({
      viewport: SIZE,
      locale: lang,
      storage: { 'fast-study:tour-dismissed': '1' },
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const shot = async (name, route) => {
      await page.goto(APP + route)
      await page.waitForLoadState('networkidle')
      await page.waitForSelector(RING[name])
      if (name === 'downloads') await pickCourse(page)
      await page.addStyleTag({
        content: `${RING[name]} { outline: 3px solid #4f5bd5; outline-offset: 4px; border-radius: 12px; }`,
      })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(800)
      const file = path.join(OUT, lang, `${name}.jpg`)
      await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY })
      console.log(`captured ${path.relative(REPO, file)} (${fs.statSync(file).size} bytes)`)
    }
    // Loads the Moodle-linked course's recordings, so the page shows a list instead of an empty body.
    const pickCourse = async (page) => {
      await page.locator('#course-source').click()
      await page.getByRole('option', { name: 'מבני נתונים', exact: true }).click()
      await page.locator('.downloads-scope-switch .mode-toggle-btn').nth(1).click()
      await page.waitForSelector('.recording-card')
      await page.waitForLoadState('networkidle')
    }
    const lectureRoute = (c, l) => `/${q(c)}/${q(l)}`
    try {
      await shot('downloads', '/downloads')
      await shot('runner', '/running')
      await shot('lecture', lectureRoute(HERO.course, HERO.lecture))
    } finally {
      await browser.close()
    }
  }
}

await seedShowcase()
await holdRun()
try {
  await capture()
} finally {
  await releaseRun()
}
