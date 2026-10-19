// The fake `curl` and `yt-dlp`, reached through PATH (a dev run resolves both by bare name).
// A download writes the fixture matching the URL into the job's temp dir in slices, so the real
// job, its progress and its SSE stream run on real growing bytes; a file auto streams is fetched
// for real. A URL path is the switch for a failure: /gone/ is a 404, /deny/ a 403, /die/ a drop.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  FAILURES,
  fixtureFor,
  headerDump,
  onAuto,
  requestHeaders,
  urlArg,
  valueAfter,
} from './tool-args.mjs';

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
  if (tool === 'curl' && onAuto(url)) return fetchThroughAuto(name);
  if (url.includes('/gone/')) fail(404);
  if (url.includes('/deny/')) fail(403);
  // Speed and the one-time drop are the fake site's live settings, changed through its /control.
  const { downloadMs, die } = await toolSettings();
  await writeSlices(name, fs.readFileSync(fixtureFor(url, FIXTURES)), downloadMs, die);
}

async function toolSettings() {
  const response = await fetch(`${process.env.HARNESS_SITE}/tool?url=${encodeURIComponent(url)}`);
  return response.json();
}

// A file auto streams hides the site URL behind an id, so curl's fetch is real: auto asks the fake
// site, which plants the /deny/ and /die/ faults, and the answer lands as curl would leave it.
async function fetchThroughAuto(name) {
  let response;
  try {
    response = await fetch(url, {
      headers: requestHeaders(args, (file) => fs.readFileSync(path.resolve(file), 'utf8')),
    });
  } catch {
    process.stderr.write(`curl: (7) Failed to connect to ${new URL(url).host}\n`);
    process.exit(7);
  }
  const dump = valueAfter(args, '--dump-header', '-D');
  if (dump) fs.writeFileSync(dump, headerDump(response.status, [...response.headers]));
  let body;
  try {
    body = Buffer.from(await response.arrayBuffer());
  } catch {
    fail('drop');
  }
  // No --fail on auto's files: a refusal's body lands as the output, its status in the dump.
  const { downloadMs } = await toolSettings();
  await writeSlices(name, body, downloadMs, false);
}

async function writeSlices(name, source, downloadMs, die) {
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
