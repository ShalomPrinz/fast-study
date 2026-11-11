// Recaptures the tour screenshot cards (downloads, lecture) as clean he/en 1440x900 JPEGs at 1.5x, plus each tour step's element rect (rects.json), from a live harness stack.
//   node frontend/scripts/capture-tour.mjs --harness DIR   (wipes the stack and seeds the showcase dataset; see docs/TOUR.md)
import fs from 'node:fs'
import path from 'node:path'
import {
  HERO,
  REPO,
  call,
  connect,
  launchBrowser,
  q,
  seedShowcase,
} from '../../.claude/harness/showcase/capture.mjs'

const OUT = path.join(REPO, 'frontend', 'src', 'assets', 'tour')
// Wide enough that the lecture page lays out in two columns (its container query flips at 640px of the main column, ~1180px of window).
const SIZE = { width: 1440, height: 900 }
const SCALE = 1.5
const QUALITY = 75
const LANGS = ['he', 'en']
// Each tour step (ids match tourSteps.ts) with its screenshot and the element(s) it marks; several matches are unioned.
const STEPS = [
  { id: 'downloads-nav', shot: 'downloads', sel: '.sidebar a[href="/downloads"]' },
  { id: 'downloads-tabs', shot: 'downloads', sel: '.downloads-tabs' },
  { id: 'downloads-scope', shot: 'downloads', sel: '.downloads-scope-switch' },
  { id: 'lectures-nav', shot: 'lecture', sel: '.sidebar-nav-block > button' },
  // The open course's block: header, Overview, lectures and Recitations are all inside its .course-group.
  {
    id: 'lectures-tree',
    shot: 'lecture',
    sel: `.course-group:has(.course-name:text-is("${HERO.course}"))`,
  },
  { id: 'lecture-pdf', shot: 'lecture', sel: '.lecture-split-pdf' },
  { id: 'lecture-ai', shot: 'lecture', sel: '.study-ai-block' },
]
const ROUTES = { downloads: '/downloads', lecture: `/${q(HERO.course)}/${q(HERO.lecture)}` }

const { APP } = connect(
  'usage: node frontend/scripts/capture-tour.mjs --harness DIR (a live app-harness stack)',
)

// Loads the Moodle-linked course's recordings, so the page shows a list instead of an empty body.
async function pickCourse(page) {
  await page.locator('#course-source').click()
  await page.getByRole('option', { name: 'מבני נתונים', exact: true }).click()
  await page.locator('.downloads-scope-switch .mode-toggle-btn').nth(1).click()
  await page.waitForSelector('.recording-card')
  await page.waitForLoadState('networkidle')
}

// The union of every match's bounding box, as fractions of the viewport.
async function rectOf(page, sel) {
  const boxes = await page.locator(sel).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return [r.left, r.top, r.right, r.bottom]
    }),
  )
  if (!boxes.length) throw new Error(`no element for ${sel}`)
  const left = Math.min(...boxes.map((b) => b[0]))
  const top = Math.min(...boxes.map((b) => b[1]))
  const right = Math.max(...boxes.map((b) => b[2]))
  const bottom = Math.max(...boxes.map((b) => b[3]))
  const f = (n) => Math.round(n * 10000) / 10000
  return {
    x: f(left / SIZE.width),
    y: f(top / SIZE.height),
    w: f((right - left) / SIZE.width),
    h: f((bottom - top) / SIZE.height),
  }
}

async function capture() {
  const rects = {}
  for (const lang of LANGS) {
    fs.mkdirSync(path.join(OUT, lang), { recursive: true })
    rects[lang] = {}
    // The tour is marked seen so it does not draw over its own screenshots.
    const { browser, context } = await launchBrowser({
      viewport: SIZE,
      deviceScaleFactor: SCALE,
      locale: lang,
      storage: { 'fast-study:tour-dismissed': '1' },
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    try {
      for (const name of Object.keys(ROUTES)) {
        const steps = STEPS.filter((s) => s.shot === name)
        await page.goto(APP + ROUTES[name])
        await page.waitForLoadState('networkidle')
        await page.waitForSelector(steps[0].sel)
        if (name === 'downloads') await pickCourse(page)
        await page.mouse.move(0, 0)
        await page.waitForTimeout(800)
        for (const s of steps) rects[lang][s.id] = await rectOf(page, s.sel)
        const file = path.join(OUT, lang, `${name}.jpg`)
        await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY })
        console.log(`captured ${path.relative(REPO, file)} (${fs.statSync(file).size} bytes)`)
      }
    } finally {
      await browser.close()
    }
  }
  const file = path.join(OUT, 'rects.json')
  fs.writeFileSync(file, JSON.stringify(rects, null, 2) + '\n')
  console.log(`wrote ${path.relative(REPO, file)}`)
}

await seedShowcase()
await capture()
