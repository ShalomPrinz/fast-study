# Download mechanics

The server never downloads inline. Each source is a `src/downloaders/*.js` descriptor
`{ tool, measure, upload, probeSize(input), buildCommand(input, tempDir) }` registered in
`downloaders/index.js`, and `runner.js#runDownloadJob` is source-agnostic: private temp dir, size
probe, the silent child spawned in that dir, and on a clean exit the source's `upload` —
`uploadVideo` for curl/yt-dlp, `uploadMaterial` for `fetch`. A new source is a new module + one
registry line.

Every tool spawn — the runner's child, the yt-dlp size probe, the yt-dlp self-update — spreads
`NO_WINDOW` from `@faststudy/tools`, or a packaged build flashes a console window per spawn
([why](../../../lib/tools/CLAUDE.md)).

## curl (generic `.mp4`)

Streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin checks, so a naive
download 403s; replaying the browser's exact captured headers reuses the live session.

`SKIP_HEADERS` strips `range`, `if-range`, `if-none-match`, `if-modified-since`, `host` and
`content-length` before replay (and in the size probe). A captured request is often a ranged segment
fetch, and replaying its `Range:` saves a partial body missing the MP4 header at offset 0 — unplayable.

Flags: `-L --fail --compressed --silent --show-error --retry 3 --retry-delay 2 --retry-all-errors`.
`--retry-all-errors` covers CDNs that close TLS without `close_notify` mid-stream (OpenSSL 3 →
`SSL_read: unexpected eof`). `--silent` because the server renders progress; `--show-error` still
writes a failure reason for the stderr tail. `fetch` is the same curl with no header replay — its URL
authenticates by its own query-string token.

## yt-dlp (YouTube, Drive and direct video links)

YouTube serves DASH-segmented streams — separate audio and video behind signed URLs — so the
`.mp4`-capture flow gets nothing usable; yt-dlp resolves the manifest, downloads both tracks and
muxes them. `-o video.%(ext)s --merge-output-format mp4` lands `video.mp4`; `--no-progress --quiet`
keeps it silent; `--cache-dir <state>/ytdlp-cache` because the default home may be read-only.

### The JS runtime

Recent yt-dlp needs a JS runtime to evaluate YouTube's player script and extract formats. Both spawn
sites — the size probe and the download — must carry the flags, or format extraction errors.

- **The runtime is this process.** `--js-runtimes node:${process.execPath}` points yt-dlp at whatever
  runs the server: node in dev, the Electron binary in a package (the server is forked from Electron
  main). Nothing extra ships — 0 bytes against 83MB for a vendored `node.exe`.
- **`ELECTRON_RUN_AS_NODE=1` is set explicitly on the spawn**, never by inheritance. yt-dlp's runtime
  probe sets nothing itself, and a bare Electron prefixes its version with a CRLF that yt-dlp's
  start-anchored `^v(\S+)` misses — it reports `node-unknown (unsupported)` and falls back silently.
  `buildCommand` returns an `env` the runner merges over `process.env`.
- **`--no-js-runtimes` comes first**, and no bare `--js-runtimes node` may follow. deno outranks node
  in yt-dlp's priority order, so without the reset a user with deno would silently get theirs; and
  the parser keys runtimes by name, so a later bare flag would overwrite the path with `null`.
- **No `--remote-components`.** The official binary already bundles `yt_dlp_ejs`, so fetching
  challenge components from GitHub on every run bought nothing and made offline use impossible.
  Freshness comes from yt-dlp's own self-update.

`auto/` runs yt-dlp only with `--flat-playlist`, which never touches the player script, so it carries
the cache flag and none of these.

### The writable copy and its self-update

Packaged, yt-dlp runs from a writable copy under the state root rather than the shipped binary,
because an app update replaces the install directory and would reset a self-updated yt-dlp;
`toolPath('yt-dlp')` resolves to the copy when it exists ([`@faststudy/tools`](../../../lib/tools/CLAUDE.md)),
so every spawn site and the `/health` probe follow it unaware.

`services/ytdlpUpdate.js` owns the copy, at startup and only when `FASTSTUDY_BIN_DIR` is set. A dev run
does nothing, so a state copy can never shadow the developer's own PATH yt-dlp.

- **Seed** when the copy is missing or older than the shipped binary, so a release carrying a newer
  yt-dlp refreshes a copy on a machine that can never reach GitHub. The bytes go to a temp name beside
  the target and are renamed over it — atomic, so a crash can't leave a truncated exe — with the
  executable bit set off Windows. The temp is removed whether or not the rename lands: Windows refuses
  to replace a copy `auto/` is running, and every later boot would strand another ~17MB. Seeding is
  synchronous and precedes the boot tool probe, so the probe spawns the binary this run's downloads
  will. A missing shipped binary (quarantined, half-installed) seeds nothing and says so in one line;
  an existing copy still works and still updates.
- **Then `<copy> -U`**, unawaited, `stdio:'ignore'`. Boot waits on nothing, but `-U` is sequenced after
  the tool probe: it swaps the exe in place, and a probe landing in that window would pin `/health` at
  `yt-dlp: missing` for the session. The child stays in the process group (never `detached`) so the
  launcher's kill on quit reaches it; yt-dlp renames the new binary over itself, so a kill before the
  rename leaves the copy intact.
- **Every failure is at most one stderr line** — offline and rate-limited GitHub are the normal case.
  Never stdout (the port-handshake channel), never a toast, a download error or a non-zero exit.

`server/` is the sole owner of both steps: `yt-dlp -U` rewrites its own executable, so two services
doing it seconds apart can leave a `.old` stub or a zero-byte binary. `auto/` just reads the same
resolver.

The knowingly-taken risk: a download started inside the ~2s `-U` swap window can fail to spawn. It
surfaces as an ordinary download error a retry fixes.

## Size probe (`services/probe.js`)

curl path: `probeContentLength` tries HEAD (works on signed URLs), then a 1-byte `Range: bytes=0-0`
GET reading the total from `Content-Range`. Both use `fetch`, which replays the captured `Cookie`.
`fetch` follows redirects itself, which matters because a 3xx's `Content-Length` is the stub's — a
few hundred bytes reported as the video would wreck the ETA — and it drops `Cookie`/`Authorization`
on a cross-origin hop, as captured credentials belong to the lecture site. The ranged GET's body is
cancelled, not drained: a server that ignores `Range` answers 200 with the whole file.

yt-dlp path: `--skip-download --print %(filesize,filesize_approx)s` over the same `bv*+ba/b`
selection the download uses, summed. It needs the JS-runtime flags too, or it resolves "unknown".
