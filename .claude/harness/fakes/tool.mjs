// The fake `curl` and `yt-dlp`, reached through PATH (a dev run resolves both by bare name).
// They never reach the lecture site's files: a download writes the fixture matching the URL into
// the job's temp dir in slices, so the real job, its byte-counting progress and its SSE stream all
// run on real growing bytes. A URL path is the switch for a failure: /gone/ is a 404, /deny/ is
// the 403 that drives the downloader's one silent re-resolve, /die/ drops halfway the first time.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { FAILURES, fixtureFor, urlArg, valueAfter } from './tool-args.mjs';

const [tool, ...args] = process.argv.slice(2);
const FIXTURES = path.join(process.env.HARNESS_DIR, 'fixtures');
const SLICES = 12;
const url = urlArg(args);

function fail(kind) {
  const [code, message] = FAILURES[kind][tool];
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function download(outputName) {
  const name = (outputName ?? 'video.mp4').replace('%(ext)s', 'mp4');
  if (url.includes('/gone/')) fail(404);
  if (url.includes('/deny/')) fail(403);
  // Speed and the one-time drop are the fake site's live settings, changed through its /control.
  const response = await fetch(`${process.env.HARNESS_SITE}/tool?url=${encodeURIComponent(url)}`);
  const { downloadMs, die } = await response.json();
  const source = fs.readFileSync(fixtureFor(url, FIXTURES));
  const target = path.resolve(process.cwd(), name);
  const handle = fs.openSync(target, 'w');
  try {
    const slice = Math.ceil(source.length / SLICES);
    for (let at = 0; at < source.length; at += slice) {
      if (die && at >= source.length / 2) fail('drop');
      fs.writeSync(handle, source.subarray(at, Math.min(at + slice, source.length)));
      await sleep(downloadMs / SLICES);
    }
  } finally {
    fs.closeSync(handle);
  }
}

if (args.includes('--version')) {
  process.stdout.write(
    tool === 'curl' ? 'curl 8.5.0 (harness fake)\n' : '2025.01.01 (harness fake)\n',
  );
} else if (args.includes('-U') || args.includes('--update')) {
  process.stdout.write('yt-dlp is up to date (harness fake)\n');
} else if (args.includes('--flat-playlist')) {
  // title<TAB>url per entry, which is the --print format the playlist expander asks for.
  process.stdout.write(
    [
      'הרצאה 1\thttps://www.youtube.com/watch?v=hunt001',
      'הרצאה 2\thttps://www.youtube.com/watch?v=hunt002',
    ].join('\n') + '\n',
  );
} else if (args.includes('--skip-download')) {
  process.stdout.write(`${fs.statSync(fixtureFor(url, FIXTURES)).size}\n`);
} else {
  await download(valueAfter(args, '--output', '-o'));
}
