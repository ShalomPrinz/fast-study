// The fake `curl` and `yt-dlp`, reached through PATH (a dev run resolves both by bare name).
// They never reach the lecture site's files: a download writes the fixture matching the URL into
// the job's temp dir in slices, so the real job, its byte-counting progress and its SSE stream all
// run on real growing bytes. A URL path is the switch for a failure: /gone/ is a 404, /deny/ is
// the 403 that drives the downloader's one silent re-resolve, /die/ drops halfway the first time.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [tool, ...args] = process.argv.slice(2);
const HARNESS = process.env.HUNT_BUGS_HARNESS;
const VIDEO = path.join(HARNESS, 'fixtures', 'video.mp4');
const PDF = path.join(HARNESS, 'fixtures', 'handout.pdf');
const SLICES = 12;

function valueAfter(...flags) {
  for (const flag of flags) {
    const at = args.indexOf(flag);
    if (at !== -1 && args[at + 1]) return args[at + 1];
  }
  return null;
}

const urlArg = [...args].reverse().find((arg) => /^https?:\/\//.test(arg)) ?? '';

// What each real tool prints for the same failure, so a job's verbatim `detail` reads true.
const FAILURES = {
  404: {
    curl: [22, 'curl: (22) The requested URL returned error: 404'],
    'yt-dlp': [1, 'ERROR: unable to download video data: HTTP Error 404: Not Found'],
  },
  403: {
    curl: [22, 'curl: (22) The requested URL returned error: 403'],
    'yt-dlp': [1, 'ERROR: unable to download video data: HTTP Error 403: Forbidden'],
  },
  drop: {
    curl: [18, 'curl: (18) transfer closed with outstanding read data remaining'],
    'yt-dlp': [1, 'ERROR: unable to download video data: Connection reset by peer'],
  },
};

function fail(kind) {
  const [code, message] = FAILURES[kind][tool];
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

// A PDF URL gets the PDF fixture, anything else the video — what a real fetch of it would bring.
function fixtureFor(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf') ? PDF : VIDEO;
  } catch {
    return VIDEO;
  }
}

async function download(outputName) {
  const name = (outputName ?? 'video.mp4').replace('%(ext)s', 'mp4');
  if (urlArg.includes('/gone/')) fail(404);
  if (urlArg.includes('/deny/')) fail(403);
  // Speed and the one-time drop are the fake site's live settings, changed through its /control.
  const response = await fetch(
    `${process.env.HUNT_BUGS_SITE}/tool?url=${encodeURIComponent(urlArg)}`,
  );
  const { downloadMs, die } = await response.json();
  const source = fs.readFileSync(fixtureFor(urlArg));
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
    tool === 'curl' ? 'curl 8.5.0 (hunt-bugs fake)\n' : '2025.01.01 (hunt-bugs fake)\n',
  );
} else if (args.includes('-U') || args.includes('--update')) {
  process.stdout.write('yt-dlp is up to date (hunt-bugs fake)\n');
} else if (args.includes('--flat-playlist')) {
  // title<TAB>url per entry, which is the --print format the playlist expander asks for.
  process.stdout.write(
    [
      'הרצאה 1\thttps://www.youtube.com/watch?v=hunt001',
      'הרצאה 2\thttps://www.youtube.com/watch?v=hunt002',
    ].join('\n') + '\n',
  );
} else if (args.includes('--skip-download')) {
  process.stdout.write(`${fs.statSync(fixtureFor(urlArg)).size}\n`);
} else {
  await download(valueAfter('--output', '-o'));
}
