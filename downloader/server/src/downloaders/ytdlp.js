import { execFile } from 'node:child_process';

export const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$|^youtu\.be$/i;

// Sum yt-dlp's printed filesize fields for the same `bv*+ba/b` selection the real
// download uses, without downloading — approximates the merged mp4's size.
function probeYoutubeSize(url) {
  return new Promise((resolve) => {
    execFile(
      'yt-dlp',
      ['--no-playlist', '--no-warnings', '--quiet', '--skip-download',
        '-f', 'bv*+ba/b', '--print', '%(filesize,filesize_approx)s', url],
      { timeout: 20000 },
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
// Recent yt-dlp needs a JS runtime for YouTube's player script; point it at node.
// Silent (--no-progress) so the server owns progress rendering. See docs/DOWNLOAD.md.
function buildYtdlpArgs(url) {
  return [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
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
