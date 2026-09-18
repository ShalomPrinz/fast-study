import { execFile } from 'node:child_process';
import { uploadVideo } from '../services/database.js';
import { statePath } from '@faststudy/runtime';
import { NO_WINDOW, toolPath } from '@faststudy/tools';

// Hosts /download-youtube accepts: YouTube plus Google Drive single-file links, both of
// which yt-dlp resolves without a login.
export const YTDLP_HOST_RE =
  /(^|\.)youtube\.com$|^youtu\.be$|^drive\.google\.com$|^docs\.google\.com$/i;

// yt-dlp's JS runtime is this process; both probe and download carry these. --no-js-runtimes must
// come first and no bare `--js-runtimes node` may follow — see docs/DOWNLOAD.md ("The JS runtime").
const YT_PLAYER_JS_FLAGS = ['--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`];

// Set explicitly, never inherited: a bare Electron's CRLF-prefixed version makes yt-dlp fall back
// silently (docs/DOWNLOAD.md).
const YT_PLAYER_JS_ENV = { ELECTRON_RUN_AS_NODE: '1' };

// yt-dlp's cache must be writable — it writes youtube-sigfuncs/<id>.json there — so it points at
// the per-user state root rather than the default under a possibly read-only installed home.
const CACHE_DIR_FLAGS = ['--cache-dir', statePath('ytdlp-cache')];

// Sum the printed filesizes for the download's own `bv*+ba/b` selection — the merged mp4's size.
// Needs YT_PLAYER_JS_FLAGS, or it resolves null even though the download would succeed.
function probeYoutubeSize(url) {
  return new Promise((resolve) => {
    execFile(
      toolPath('yt-dlp'),
      [
        '--no-playlist',
        '--no-warnings',
        '--quiet',
        '--skip-download',
        ...YT_PLAYER_JS_FLAGS,
        ...CACHE_DIR_FLAGS,
        '-f',
        'bv*+ba/b',
        '--print',
        '%(filesize,filesize_approx)s',
        url,
      ],
      { timeout: 30000, env: { ...process.env, ...YT_PLAYER_JS_ENV }, ...NO_WINDOW },
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
    '--merge-output-format',
    'mp4',
    ...YT_PLAYER_JS_FLAGS,
    ...CACHE_DIR_FLAGS,
    '--quiet',
    '--no-warnings',
    '--no-progress',
    '-o',
    'video.%(ext)s',
    url,
  ];
}

// input: { url }.
export const ytdlp = {
  tool: 'yt-dlp',
  measure: 'dir', // sum separate audio/video temp files pre-merge
  upload: uploadVideo,
  probeSize: ({ url }) => probeYoutubeSize(url),
  buildCommand: ({ url }) => ({
    command: toolPath('yt-dlp'),
    args: buildYtdlpArgs(url),
    env: YT_PLAYER_JS_ENV,
  }),
};
