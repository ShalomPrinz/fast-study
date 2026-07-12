import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveUniversity } from './registry.js';
import { listRecordings } from './core.js';
import { deriveName, promptNumber } from './naming.js';
import { postDownload, postDownloadYoutube } from './serverClient.js';
import { ask } from './prompt.js';

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

/** Parse `<courseUrl> [--course "<name>"]` from argv. */
function parseArgs(argv) {
  let course = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--course') course = argv[++i];
    else positional.push(argv[i]);
  }
  return { courseUrl: positional[0], course };
}

/** Interactive download loop: pick a recording, capture it, POST to server.js. */
async function downloadLoop(page, items, course) {
  for (;;) {
    const answer = await ask('\nPick a recording number to download (q to quit): ');
    if (answer === 'q' || answer === '') break;
    const idx = parseInt(answer, 10);
    if (!Number.isInteger(idx) || idx < 1 || idx > items.length) {
      console.log('Invalid selection.');
      continue;
    }
    const { recording, extractor } = items[idx - 1];
    try {
      // captureVideo resolves the actual downloadable video (videostream: sniff the
      // .mp4 fresh; youtube: follow the redirect + let the user pick a playlist entry).
      const cap = await extractor.captureVideo(page, recording);
      const lecture = deriveName(cap.title, cap.kind) ?? (await promptNumber(cap.kind));
      if (recording.strategy === 'videostream') {
        await postDownload({ url: cap.url, headers: cap.headers, course, lecture, kind: cap.kind });
      } else {
        await postDownloadYoutube({ url: cap.url, course, lecture, kind: cap.kind });
      }
      console.log(`✓ Sent "${cap.title}" → ${course}/${lecture} (${recording.strategy})`);
    } catch (err) {
      console.log(`✗ Failed: ${err.message ?? err}`);
    }
  }
}

async function main() {
  const { courseUrl, course } = parseArgs(process.argv.slice(2));
  if (!courseUrl) {
    console.error('Usage: node src/index.js <courseUrl> [--course "<name>"]');
    process.exit(1);
  }

  // 1. Auth + LMS parser are per-university (by host); throws if no handler.
  const uni = resolveUniversity(courseUrl);
  const state = await uni.auth().getAuthState(courseUrl);

  // 2. Orchestrator owns the browser: headless context from the auth state. Listing
  //    is DOM-only, so no .mp4 sniffer here — that runs inside captureVideo, which
  //    reuses this same page to open a recording's view.php / redirect page.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    await page.goto(courseUrl, { waitUntil: 'load' });

    // 3. Enumerate activities and route each to its extractor (shared with the
    //    HTTP service via core.js). Each recording stays paired with the extractor
    //    that resolves it, for the interactive download loop below.
    const items = await listRecordings(page, courseUrl); // { recording, extractor }[]
    const recordings = items.map((it) => it.recording);

    console.log(`\nDiscovered ${recordings.length} recording(s) for ${courseUrl}:`);
    recordings.forEach((r, i) => {
      console.log(`  [${i + 1}] (${r.kind}) ${r.title || '(untitled)'} — ${r.strategy}`);
    });

    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    const outFile = path.join(CAPTURES_DIR, `${slugify(courseUrl)}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ courseUrl, recordings }, null, 2));
    console.log(`\nWrote ${recordings.length} recording(s) to ${outFile}`);

    // 4. Download phase — only when a --course name is given (it's the required
    //    input for server.js's endpoints). Otherwise just list and hint.
    if (!course) {
      console.log('\nHint: pass --course "<name>" to enable interactive download.\n');
    } else if (recordings.length) {
      await downloadLoop(page, items, course);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
