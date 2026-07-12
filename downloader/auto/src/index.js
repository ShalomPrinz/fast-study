import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSite } from './registry.js';

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

  const { auth, source } = resolveSite(courseUrl); // throws with a clear message if no handler
  const authState = await auth.getAuthState();
  const videos = await source.listVideos(authState, courseUrl);

  console.log(`\nDiscovered ${videos.length} video(s) for ${courseUrl}:`);
  videos.forEach((v, i) => {
    let where = v.url;
    try {
      const u = new URL(v.url);
      where = `${u.hostname}/…/${u.pathname.split('/').pop()}`;
    } catch {
      /* keep raw url */
    }
    console.log(`  [${i + 1}] ${v.title ?? '(untitled)'} — ${where}`);
  });

  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  const outFile = path.join(CAPTURES_DIR, `${slugify(courseUrl)}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ courseUrl, videos }, null, 2));
  console.log(`\nWrote ${videos.length} capture(s) to ${outFile}\n`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
