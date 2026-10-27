import { execFile } from 'node:child_process';
import { uploadVideo } from '../services/database.js';
import { statePath } from '@faststudy/runtime';
import { NO_WINDOW, toolPath } from '@faststudy/tools';
import { SKIP_HEADERS } from '../services/probe.js';

// Hosts /download-youtube accepts: YouTube plus Google Drive single-file links, both of
// which yt-dlp resolves without a login. /download-url takes any http(s) URL, via auto.
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

// Packaged, the bundled ffmpeg is off PATH, and yt-dlp without one exits 0 having skipped the
// merge, leaving no video.mp4. Dev keeps PATH's: a bare `ffmpeg` here would read as missing.
const FFMPEG_FLAGS = process.env.FASTSTUDY_BIN_DIR ? ['--ffmpeg-location', toolPath('ffmpeg')] : [];

// Video capped at 720p: the pipeline keeps only the audio track and nothing plays the video, so more
// is pure size. The trailing /b keeps Drive and generic URLs, whose formats often carry no height.
const FORMAT_FLAGS = ['-f', 'bv*[height<=720]+ba/b[height<=720]/b'];

// Sum the printed filesizes for the download's own FORMAT_FLAGS selection — the merged mp4's size.
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
        ...FFMPEG_FLAGS,
        ...FORMAT_FLAGS,
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

// -o video.%(ext)s + merge/remux to mp4 -> always video.mp4, even for a lone .webm/.mkv that
// needs no merge. Silent (--no-progress) so the server owns progress rendering. See docs/DOWNLOAD.md.
function buildYtdlpArgs(url) {
  return [
    '--no-playlist',
    '--merge-output-format',
    'mp4',
    '--remux-video',
    'mp4',
    ...YT_PLAYER_JS_FLAGS,
    ...CACHE_DIR_FLAGS,
    ...FFMPEG_FLAGS,
    ...FORMAT_FLAGS,
    '--quiet',
    '--no-warnings',
    '--no-progress',
    '-o',
    'video.%(ext)s',
    url,
  ];
}

// Not replayed as headers: --add-header is global in yt-dlp, so these would reach every host a
// playlist names. Credentials ride a host-scoped cookie jar instead (docs/DOWNLOAD.md, "HLS").
const HLS_SKIP_HEADERS = new Set([...SKIP_HEADERS, 'accept-encoding', 'authorization', 'cookie']);
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const hasControl = (t) => [...t].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
const COOKIE_NAME_RE = /^[^\s=;]+$/;

// Netscape jar text with the captured `Cookie` header's pairs scoped to `url`'s host only
// (host-only, not subdomains); null when there is none.
export function buildCookieJar(url, headers) {
  const { hostname, protocol } = new URL(url);
  const secure = protocol === 'https:' ? 'TRUE' : 'FALSE';
  const expiry = Math.floor(Date.now() / 1000) + 86400;
  const lines = [];
  for (const h of headers ?? []) {
    if (h?.name?.toLowerCase() !== 'cookie' || typeof h.value !== 'string') continue;
    for (const pair of h.value.split(';')) {
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (eq < 1 || !COOKIE_NAME_RE.test(name) || hasControl(name + value)) continue;
      lines.push([hostname, 'FALSE', '/', secure, expiry, name, value].join('\t'));
    }
  }
  return lines.length ? `# Netscape HTTP Cookie File\n${lines.join('\n')}\n` : null;
}

// buildYtdlpArgs plus one --add-header per replayed non-credential header (a name/value that could
// not be one header line skipped) and `--cookies cookieFile` when given. 720p -f carries over.
export function buildHlsArgs(url, headers, cookieFile = null) {
  const replay = [];
  for (const h of headers ?? []) {
    if (!HEADER_NAME_RE.test(h?.name ?? '') || HLS_SKIP_HEADERS.has(h.name.toLowerCase())) continue;
    if (typeof h.value !== 'string' || /[\r\n]/.test(h.value)) continue;
    replay.push('--add-header', `${h.name}: ${h.value}`);
  }
  if (cookieFile) replay.push('--cookies', cookieFile);
  return [...replay, ...buildYtdlpArgs(url)];
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
