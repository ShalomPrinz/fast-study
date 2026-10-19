// The fake tool's reading of its command line and its failure table, taking argv and the fixture
// dir as arguments so the unit tests can check them without spawning the tool.
import path from 'node:path';

/** The value after the first of `flags` present in `args`, or null. */
export function valueAfter(args, ...flags) {
  for (const flag of flags) {
    const at = args.indexOf(flag);
    if (at !== -1 && args[at + 1]) return args[at + 1];
  }
  return null;
}

/** The URL a download is for: the last http(s) argument, '' when there is none. */
export function urlArg(args) {
  return [...args].reverse().find((arg) => /^https?:\/\//.test(arg)) ?? '';
}

// What each real tool prints for the same failure, so a job's verbatim `detail` reads true.
export const FAILURES = {
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

// A PDF URL gets the PDF fixture, anything else the video — what a real fetch of it would bring.
export function fixtureFor(url, fixtures) {
  try {
    const pdf = new URL(url).pathname.toLowerCase().endsWith('.pdf');
    return path.join(fixtures, pdf ? 'handout.pdf' : 'video.mp4');
  } catch {
    return path.join(fixtures, 'video.mp4');
  }
}

/** Whether `url` is a file auto streams (`/moodle/file/<id>`), which the fake fetches for real. */
export function onAuto(url) {
  try {
    return new URL(url).pathname.startsWith('/moodle/file/');
  } catch {
    return false;
  }
}

/** The request headers curl's `-H` arguments name, an `@file` one read through `read(file)`. */
export function requestHeaders(args, read) {
  const lines = [];
  args.forEach((arg, at) => {
    if ((arg !== '-H' && arg !== '--header') || !args[at + 1]) return;
    const value = args[at + 1];
    lines.push(...(value.startsWith('@') ? read(value.slice(1)).split('\n') : [value]));
  });
  const headers = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/** A `--dump-header` file for one answer, as curl writes it: the status line, then each header. */
export function headerDump(status, headers) {
  const lines = [`HTTP/1.1 ${status}`, ...headers.map(([name, value]) => `${name}: ${value}`)];
  return `${lines.join('\r\n')}\r\n\r\n`;
}
