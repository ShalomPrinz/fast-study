import { execFile } from 'node:child_process';

export const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$|^youtu\.be$/i;

// Recent yt-dlp needs a JS runtime to run YouTube's player script and extract
// formats; both the probe and the download must carry these or format extraction errors.
const YT_PLAYER_JS_FLAGS = ['--js-runtimes', 'node', '--remote-components', 'ejs:github'];

// Sum yt-dlp's printed filesize fields for the same `bv*+ba/b` selection the real
// download uses, without downloading — approximates the merged mp4's size.
// Needs YT_PLAYER_JS_FLAGS: without a JS runtime yt-dlp can't extract formats, so the
// probe would error and resolve null ("unknown") even though the download succeeds.
function probeYoutubeSize(url) {
  return new Promise((resolve) => {
    execFile(
      'yt-dlp',
      ['--no-playlist', '--no-warnings', '--quiet', '--skip-download',
        ...YT_PLAYER_JS_FLAGS,
        '-f', 'bv*+ba/b', '--print', '%(filesize,filesize_approx)s', url],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) return resolve(null);
        let total = 0;
        for (const line of (stdout ?? '').split('\n')) {
          const n = parseInt(line.trim(), 10);
          if (Number.isFinite(n)) total += n;
        }
        resolve(total > 0 ? total : null);
      },
    );
  });
}

// YouTube DASH streams. -o video.%(ext)s + --merge-output-format mp4 -> video.mp4.
// Silent (--no-progress) so the server owns progress rendering. See docs/DOWNLOAD.md.
function buildYtdlpArgs(url) {
  return [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    ...YT_PLAYER_JS_FLAGS,
    '--quiet', '--no-warnings', '--no-progress',
    '-o', 'video.%(ext)s',
    url,
  ];
}

// input: { url }.
export const ytdlp = {
  tool: 'yt-dlp',
  measure: 'dir', // sum separate audio/video temp files pre-merge
  probeSize: ({ url }) => probeYoutubeSize(url),
  buildCommand: ({ url }) => ({ command: 'yt-dlp', args: buildYtdlpArgs(url) }),
};
