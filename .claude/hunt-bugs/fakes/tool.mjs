// The fake `curl` and `yt-dlp`, reached through PATH (a dev run resolves both by bare name).
// They never open a socket: a download writes the fixture video into the job's temp dir in slices,
// so the real job, its byte-counting progress and its SSE stream all run on real growing bytes.
// A URL path is the switch for a failure: /gone/ is a 404, /deny/ is the 403 that drives the
// downloader's one silent re-resolve.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [tool, ...args] = process.argv.slice(2);
const HARNESS = process.env.HUNT_BUGS_HARNESS;
const VIDEO = path.join(HARNESS, 'fixtures', 'video.mp4');
const TOTAL_MS = Number(process.env.HUNT_BUGS_DOWNLOAD_MS ?? 3000);
const SLICES = 12;

function valueAfter(...flags) {
  for (const flag of flags) {
    const at = args.indexOf(flag);
    if (at !== -1 && args[at + 1]) return args[at + 1];
  }
  return null;
}

const urlArg = [...args].reverse().find((arg) => /^https?:\/\//.test(arg)) ?? '';

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function download(outputName) {
  const name = (outputName ?? 'video.mp4').replace('%(ext)s', 'mp4');
  if (urlArg.includes('/gone/')) {
    fail(22, `${tool}: (22) The requested URL returned error: 404`);
  }
  if (urlArg.includes('/deny/')) {
    fail(22, `${tool}: (22) The requested URL returned error: 403 Forbidden`);
  }
  const source = fs.readFileSync(VIDEO);
  const target = path.resolve(process.cwd(), name);
  const handle = fs.openSync(target, 'w');
  try {
    const slice = Math.ceil(source.length / SLICES);
    for (let at = 0; at < source.length; at += slice) {
      fs.writeSync(handle, source.subarray(at, Math.min(at + slice, source.length)));
      await sleep(TOTAL_MS / SLICES);
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
  process.stdout.write(`${fs.statSync(VIDEO).size}\n`);
} else {
  await download(valueAfter('--output', '-o'));
}
