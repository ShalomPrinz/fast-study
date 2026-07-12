import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveUniversity, resolveExtractor } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = path.resolve(__dirname, '..', 'captures');

function slugify(courseUrl) {
  try {
    const u = new URL(courseUrl);
    return `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'course';
  } catch {
    return 'course';
  }
}

async function main() {
  const courseUrl = process.argv[2];
  if (!courseUrl) {
    console.error('Usage: node src/index.js <courseUrl>');
    process.exit(1);
  }

  // 1. Auth + LMS parser are per-university (by host); throws if no handler.
  const uni = resolveUniversity(courseUrl);
  const state = await uni.auth().getAuthState(courseUrl);

  // 2. Orchestrator owns the browser: headless context from the auth state. Listing
  //    is DOM-only, so no .mp4 sniffer here — that belongs to the later download
  //    phase (captureVideo registers one right before opening a view.php page).
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    await page.goto(courseUrl, { waitUntil: 'load' });

    // 3. Enumerate activities (per-LMS), then route each to its extractor
    //    (per-activity, by modType). Unhandled types (e.g. resource/PDF) → skip.
    const activities = await uni.parse(page);
    const recordings = [];
    for (const activity of activities) {
      const extractor = resolveExtractor(activity);
      if (!extractor) {
        console.log(`  skipped: ${activity.title || '(untitled)'} (${activity.modType || 'unknown'})`);
        continue;
      }
      recordings.push(...extractor.toRecordings(activity));
    }

    console.log(`\nDiscovered ${recordings.length} recording(s) for ${courseUrl}:`);
    recordings.forEach((r, i) => {
      console.log(`  [${i + 1}] (${r.kind}) ${r.title || '(untitled)'} — ${r.strategy}`);
    });

    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    const outFile = path.join(CAPTURES_DIR, `${slugify(courseUrl)}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ courseUrl, recordings }, null, 2));
    console.log(`\nWrote ${recordings.length} recording(s) to ${outFile}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
