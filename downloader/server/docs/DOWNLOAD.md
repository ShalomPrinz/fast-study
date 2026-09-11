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

Args: `--no-playlist --merge-output-format mp4 --no-js-runtimes --js-runtimes
node:<execPath> --cache-dir <state>/ytdlp-cache --quiet --no-warnings --no-progress -o
video.%(ext)s`. `-o video.%(ext)s` + merge → final `video.mp4`.

### The JS runtime

Recent yt-dlp needs a JS runtime to evaluate YouTube's player script and extract formats.
Both spawn sites — the size probe and the download — must carry the flags, or format
extraction errors.

- **The runtime is this process.** `node:${process.execPath}` points yt-dlp at whatever is
  running the server: node in dev, the Electron binary in a package (the server is forked
  from Electron main). Nothing extra ships — 0 bytes against 83MB for a vendored `node.exe`.
- **`ELECTRON_RUN_AS_NODE=1` is set explicitly on the spawn**, never by inheritance. yt-dlp's
  runtime probe sets nothing itself, and a bare Electron prefixes its version with a CRLF that
  yt-dlp's start-anchored `^v(\S+)` misses — it reports `node-unknown (unsupported)` and falls
  back silently. `buildCommand` returns an `env` the runner merges over `process.env`.
- **`--no-js-runtimes` comes first**, and no bare `--js-runtimes node` may follow. deno
  outranks node in yt-dlp's priority order, so without the reset a user with deno installed
  would silently get theirs; and the parser keys runtimes by name, so a later bare flag would
  overwrite the resolved path with `null`.
- **No `--remote-components`.** The official yt-dlp binary already bundles `yt_dlp_ejs`, so
  fetching challenge components from GitHub on every probe and every download bought nothing
  and made an offline render impossible. Freshness comes from yt-dlp's own self-update.

`auto/` runs yt-dlp too, but only `--flat-playlist`, which never touches the player script —
so it carries the cache flag and not these.

### The writable copy and its self-update

Packaged, yt-dlp runs from `<state>/bin/yt-dlp` rather than from the shipped binary under
`FASTSTUDY_BIN_DIR`: `toolPath('yt-dlp')` (`@faststudy/tools`) answers with the state copy when it
exists and the shipped one otherwise, so both spawn sites and the `/health` probe follow it without
knowing it is there. The reason it cannot live beside the other binaries is that an update replaces
the whole install directory — a yt-dlp that updated itself there would reset to the shipped version
on every release, while the state root survives.

`services/ytdlpUpdate.js` owns that copy, at startup and only when `FASTSTUDY_BIN_DIR` is set. A dev
run does nothing at all: no seed, no `-U`, so a state copy can never shadow the developer's own
PATH yt-dlp.

- **Seed** when the copy is missing or older than the shipped binary, so a release carrying a newer
  yt-dlp also refreshes a copy on a machine that can never reach GitHub. The bytes go to a temp name
  beside the target and are renamed over it — a rename is atomic, so a crash mid-copy cannot leave a
  truncated exe — and the executable bit is set on non-Windows.
- **Then `<copy> -U`**, unawaited, `stdio: 'ignore'`. Boot waits on nothing and nothing is sequenced
  against it: until the copy exists every caller resolves to the shipped binary, and a few minutes
  on that costs nothing. The child stays in the process group (never `detached`) so the launcher's
  kill on quit reaches it; yt-dlp writes the new binary and renames over itself, so a kill before
  that rename leaves the working copy intact.
- **Every failure is at most one line on stderr** — offline, rate-limited and transient GitHub
  failures are the normal case. Never stdout (that is the port-handshake channel), and never a
  toast, a download error or a non-zero exit; `launch.log` is this feature's whole user-visible
  surface.

`server/` is the sole owner of both the seed and the `-U`. `yt-dlp -U` rewrites its own executable
in place, so two services doing it seconds apart can leave a `.old` stub or a zero-byte binary;
`auto/` needs no update logic of its own because it reads the same resolver.

The knowingly-taken risk: `-U` swaps the executable while the app is already usable, so a download
started inside the ~2s swap window can fail to spawn. It surfaces as an ordinary download error that
a retry fixes.

## Size probe (`services/probe.js`)

curl path: `probeContentLength` tries HEAD (works on signed URLs, token in the query
string), then falls back to a 1-byte `Range: bytes=0-0` GET and reads the total from
`Content-Range`. Both use `fetch`, which replays the captured `Cookie` header fine — the
forbidden-header list is a browser rule, not a Node one.

Redirects are followed by `fetch` itself, which matters because a 3xx's `Content-Length` is
the redirect stub's: reporting a few hundred bytes as the video's size would wreck the ETA
and progress percentage. `fetch` also drops `Cookie`/`Authorization` on a cross-origin hop,
which is the behavior this probe wants — captured credentials belong to the lecture site,
not to whatever it redirects to. The ranged GET's body is cancelled rather than drained: a
server that ignores `Range` answers 200 with the whole file.

yt-dlp path: `--skip-download --print %(filesize,filesize_approx)s` over the same
`bv*+ba/b` format selection the real download uses; the printed sizes are summed.
