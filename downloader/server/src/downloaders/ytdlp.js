import { execFile } from 'node:child_process';
import { uploadVideo } from '../services/database.js';
import { statePath } from '@faststudy/runtime';
import { toolPath } from '@faststudy/tools';

// Hosts /download-youtube accepts: YouTube plus Google Drive single-file links, both of
// which yt-dlp resolves without a login.
export const YTDLP_HOST_RE =
  /(^|\.)youtube\.com$|^youtu\.be$|^drive\.google\.com$|^docs\.google\.com$/i;

// Recent yt-dlp needs a JS runtime to run YouTube's player script and extract formats; both the
// probe and the download must carry these or format extraction errors. The runtime is the process
// running this server — Electron in a package, node in dev — so no separate binary ships.
// --no-js-runtimes first is load-bearing: deno outranks node in yt-dlp's priority order, so a user
// with deno installed would silently get theirs. Never add a bare `--js-runtimes node` after this
// pair — the parser keys runtimes by name, so the later flag would overwrite the path with null.
const YT_PLAYER_JS_FLAGS = ['--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`];

// Electron only behaves as node when told to, and it must be told explicitly rather than by
// inheritance: yt-dlp's runtime probe sets nothing, and a bare Electron prefixes its version with
// a CRLF that yt-dlp's start-anchored `^v(\S+)` misses — it then reports `node-unknown
// (unsupported)` and falls back silently.
const YT_PLAYER_JS_ENV = { ELECTRON_RUN_AS_NODE: '1' };

// yt-dlp's cache must be writable — it writes youtube-sigfuncs/<id>.json there — so it points at
// the per-user state root rather than the default under a possibly read-only installed home.
const CACHE_DIR_FLAGS = ['--cache-dir', statePath('ytdlp-cache')];

// Sum yt-dlp's printed filesize fields for the same `bv*+ba/b` selection the real
// download uses, without downloading — approximates the merged mp4's size.
// Needs YT_PLAYER_JS_FLAGS: without a JS runtime yt-dlp can't extract formats, so the
// probe would error and resolve null ("unknown") even though the download succeeds.
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
      { timeout: 30000, env: { ...process.env, ...YT_PLAYER_JS_ENV } },
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
