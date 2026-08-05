# Download mechanics

The server never downloads inline; each source is a `src/downloaders/*.js` module
implementing `{ tool, measure, upload, probeSize(input), buildCommand(input, tempDir) }`,
registered in `downloaders/index.js`. `runner.js#runDownloadJob` is source-agnostic:
make a private temp dir, probe + log the expected size, `spawn` the silent child in
that dir, and on a clean exit call the source's `upload` (upload + cleanup + notify) —
`uploadVideo` for curl/yt-dlp, `uploadMaterial` for `fetch`. Adding a source is a new
module + one registry line — no runner/route edits.

## curl (generic `.mp4`)

Streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin
checks. We replay the browser's exact captured headers so the live session is
reused — a naive download 403s.

`SKIP_HEADERS` strips `range`, `if-range`, `if-none-match`, `if-modified-since`,
`host`, `content-length` before replay. If the captured request was a ranged
segment fetch, replaying `Range:` makes curl save a partial body missing the MP4
header at offset 0 — unplayable. (Same set is stripped in the size probe.)

Flags: `-L --fail --compressed --silent --show-error --retry 3 --retry-delay 2
--retry-all-errors --output video.mp4`. `--retry-all-errors` covers CDNs that
close TLS without `close_notify` mid-stream (OpenSSL 3 → `SSL_read: unexpected
eof`). `--silent` because the server, not curl, renders progress; `--show-error`
still writes a failure reason to stderr for the tail buffer.

## yt-dlp (YouTube)

YouTube serves DASH-segmented streams (separate audio/video behind signed URLs),
so the `.mp4`-capture flow gets nothing usable; yt-dlp resolves the manifest,
downloads both tracks, and muxes them.

Args: `--no-playlist --merge-output-format mp4 --js-runtimes node --remote-components
ejs:github --quiet --no-warnings --no-progress -o video.%(ext)s`. `-o video.%(ext)s`

- merge → final `video.mp4`. **Prerequisite:** recent yt-dlp needs a JS runtime to
  evaluate YouTube's player script; only `deno` is auto-enabled, so we point it at the
  `node` already present. yt-dlp must be installed system-wide (`pipx install yt-dlp`);
  the server does not install it — same external-CLI dependency as ffmpeg is for the
  backend.

## Size probe (`services/probe.js`)

curl path: `probeContentLength` tries HEAD (works on signed URLs, token in the query
string), then falls back to a 1-byte `Range: bytes=0-0` GET and reads the total from
`Content-Range`. **This module deliberately keeps raw `node:http`/`https`** — it
replays the captured `Cookie` header, which `fetch`/undici forbid setting.

yt-dlp path: `--skip-download --print %(filesize,filesize_approx)s` over the same
`bv*+ba/b` format selection the real download uses; the printed sizes are summed.
