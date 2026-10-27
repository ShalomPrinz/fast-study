# Download mechanics

The server never downloads inline. Each source is a `src/downloaders/*.js` descriptor
`{ tool, measure, upload, probeSize(input), buildCommand(input, tempDir) }` registered in
`downloaders/index.js`, and `runner.js#runDownloadJob` is source-agnostic: private temp dir, size
probe, the silent child spawned in that dir, and on a clean exit the source's `upload` —
`uploadVideo` for curl/yt-dlp, `uploadMaterial` for `fetch` (temp file `material.bin`, the original
name carried in the input's `filename` and sent to the database, which picks the disk extension). `fetchAssignment` is `fetch` with the assignment-files upload, chosen in `toRun` when the `/resolve` answer's `media` is `assignment`; an assignment answer that is not a `fetch` target with a `filename` is refused (`toRun` → `null`, the 502). A new source is a new module + one
registry line.

## General mode — into a computer folder (`src/generalFolder.js`)

`dest:'folder'` on `/download`, `/download-youtube` or `/upload-pdf` (the popup's "General video")
saves the file into a folder on the computer instead of the database: same job, child, progress,
cancel and timing sample, but the runner's last step is the route's `save` (a move out of the temp
dir) instead of the source's `upload` — no course, no `/video-arrived`, no notify.

- **The folder** is this server's state, `statePath('general-folder.json')`, defaulting to
  `~/Downloads`. The popup only shows it: a native picker can't run there (Chrome closes the popup
  when the OS dialog takes focus, and `showDirectoryPicker` yields no path), so "Choose folder…"
  calls `POST /general-folder/pick`, which pushes `folder:pick {folder}` to every `/events?picker=1`
  stream — only a window that can open Electron's picker opens one — which then `POST /general-folder`s
  the answer. No picker stream → `409 folder_picker_unavailable`; plain streams never count.
- **Checked at request time**: an absolute, existing, writable directory, else `409
  general_folder_missing {folder}` / `general_folder_not_writable {folder, detail}`. `fileName` goes
  through `storedName` (traversal and separators refused, the rest made Windows-legal).
- **Never overwrites**: the name is `<stem><ext>` with the extension of the file actually produced
  (`.mp4`, yt-dlp's choice, `.pdf`), then ` (2)`, ` (3)`… — claimed with an exclusive create, so two
  jobs finishing together can't pick the same one. A cross-drive rename (`EXDEV`) copies + unlinks;
  any failure is `general_folder_save_failed {folder, detail}`.

Every tool spawn — the runner's child, the yt-dlp size probe, the yt-dlp self-update — spreads
`NO_WINDOW` from `@faststudy/tools`, or a packaged build flashes a console window per spawn
([why](../../../lib/tools/CLAUDE.md)).

A spawn that fails, a non-zero exit and a throw before either are three different job codes, each
carrying the tool and whatever the tool said as `detail` ([JOBS.md](JOBS.md)). The stderr tail is
third-party text, so it rides as `detail` and is never translated.

## curl (generic `.mp4`)

Streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin checks, so a naive
download 403s; replaying the browser's exact captured headers reuses the live session.

`SKIP_HEADERS` strips `range`, `if-range`, `if-none-match`, `if-modified-since`, `host` and
`content-length` before replay (and in the size probe). A captured request is often a ranged segment
fetch, and replaying its `Range:` saves a partial body missing the MP4 header at offset 0 — unplayable.

Flags: `-L --fail --compressed --silent --show-error --retry 3 --retry-delay 2 --retry-all-errors`.
`--retry-all-errors` covers CDNs that close TLS without `close_notify` mid-stream (OpenSSL 3 →
`SSL_read: unexpected eof`). `--silent` because the server renders progress; `--show-error` still writes a failure reason for the
stderr tail. `fetch` is the same curl with no header replay.

A target on auto/ (any file on the Moodle host, `fetch` or `curl`) carries no captured headers —
auto/ keeps them — only the launch secret and the Moodle wait marker, from a `-H @file` in the temp
dir, never argv. auto/ answers its `HEAD` from memory and the probe skips the ranged fallback there,
so sizing costs no turn of the Moodle lock.

A URL on auto/ takes none of `--fail`/`--retry*`: its refusal (a `503 site_blocked`, a `401`) is a
typed answer a re-send cannot fix, and each re-send would queue on its gate and hit Moodle again.
curl dumps auto's headers to `response-headers.txt` and keeps its JSON body in the output file, and
the runner ends the job with auto's own `code`/`params` (`readAutodlRefusal`). A fetch from auto cut
short with no refusal (curl exit 18, 52 or 56) is re-run once in a fresh temp dir (`recovery`).

## HLS (`.m3u8` captures)

Panopto and other HLS players never load a whole `.mp4`, so the extension also captures requests
whose path ends in `.m3u8`. The server decides which captures are worth showing; MV3 cannot read
response bodies, so it fetches each playlist itself with the replayed headers.

- **`POST /hls-streams`** `{captures:[{url, headers}]}` (at most 30 `.m3u8` plus 100 others) → `{streams, failed, segments}`. `streams` is
  `[{url, kind:'master'|'media', hasAudio, hasVideo, durationSeconds, estimatedBytes}]`, best first:
  `hasAudio:true`, then unknown (`null`), then audio-less. Masters are offered; a variant or audio
  playlist a captured master references (`#EXT-X-STREAM-INF`/`#EXT-X-MEDIA`, compared ignoring the
  query) is hidden, and a media playlist no master references is offered once. `url` is the capture's
  own, so the caller maps back to its headers. `failed` is `[{url, detail}]` for a capture that could
  not be read (`HTTP 403`, a network error); a non-playlist body is dropped silently. Pure logic is
  `src/hlsPlaylist.js`, the fetching `services/hls.js`.
- **`segments`** answers which non-`.m3u8` captures (the extension's `.mp4` ones, sent in the same
  `captures`, never fetched, capped apart from the playlists) are really HLS pieces: an fMP4 stream's
  `#EXT-X-MAP` init section or segment URI (`fragmented.mp4`, with `#EXT-X-BYTERANGE`) ends in `.mp4`.
  It is the subset of those capture URLs, as sent, whose URL resolved against the playlist and
  compared ignoring the query matches a media playlist's map or segment. The playlists searched are
  the captured media playlists, plus (only while some `.mp4` is still unmatched) up to 20 media
  playlists in total per request (each URL once, round-robin over the masters, 4 at a time, stopping
  once every `.mp4` matches), fetched with their master's headers, so a player that captured only
  the master still resolves. The estimate reuses a looked-up variant instead of refetching it.
- **Audio** is read from the master in-process, with no binary probe: an `#EXT-X-MEDIA:TYPE=AUDIO`
  group or an audio codec (`mp4a`, `ac-3`, `ec-3`, `opus`…) in any variant's `CODECS` is `true`;
  `CODECS` on every variant and none audio is `false`; no information is `null`. Segments are never
  fetched, so a master that omits `CODECS` stays `null`, and a media playlist is `null` unless its
  segments are `.aac`/`.m4a`/`.mp3`.
- **Estimate**: one extra fetch of the variant the 720p cap would pick; `durationSeconds` sums its
  `#EXTINF`, `estimatedBytes` is that × the variant's bandwidth ÷ 8. Either is `null` when unreadable.
  `POST /probe-size` answers the same estimate for an `.m3u8` url, and it is the job's expected size.
- **Credentials** (`Cookie`, `Authorization`) go only to the capture's own origin: the classify
  fetches drop them on any other origin, and a download never passes them to yt-dlp as headers,
  because `--add-header` is global (every playlist, segment, key and redirect host). `Cookie` becomes
  a Netscape `--cookies` jar (`cookies.txt` in the job's temp dir, mode 0600, removed with it, never
  logged) holding host-only cookies for the capture's host, which yt-dlp's cookie jar sends nowhere
  else; `Authorization` is not forwarded, so an HLS capture gated by it alone fails with
  `download_auth_failed`. Checked on yt-dlp 2026.08.19: with a cookie-gated playlist host and
  segments on a second host, the segment host received no `Cookie`. `accept-encoding` and
  `SKIP_HEADERS` are not replayed.
- **Shapes** (parse and select, `src/hlsPlaylist.js`): a master parses to variants
  `{url, bandwidth, height, codecs, audioGroup}`, `audioGroups` and every URI it references; a media
  playlist to `{durationSeconds, audioOnly, resourceUrls}` (map and segment URLs, query dropped). A capture is offered as a master, or as a media
  playlist no captured master references. Captures of the same content collapse to the first sent
  (newest, so the freshest token): masters with the same resolved variant/rendition URIs (query kept,
  as a CDN may pick the stream by it; a master with no URIs falls back to its query-stripped URL), or
  media playlists with the same segment URIs, query-stripped, both compared as sets. A path alone is not enough, a
  different variant list is a different stream. Playlist
  bodies are read through a 2 MiB cap, so a larger or endless one lands in `failed` as
  `playlist too large`.
- **`POST /download`** with an `.m3u8` url (path, not query) picks the `hls` descriptor instead of
  `curl`; body, `dest:'folder'`, jobs and the answer are unchanged. It is the yt-dlp command below plus
  one `--add-header 'Name: value'` per replayed non-credential header (names that are not an HTTP token, values with
  CR/LF, `SKIP_HEADERS` and `accept-encoding` skipped) plus the `--cookies` jar above. Same `yt-dlp` tool, `download:ytdlp` timing bucket and 720p cap, so the output is
  `video.mp4`. A 401/403 on an expired playlist or segment lands as `download_auth_failed`, other
  exits as `download_tool_failed`, the yt-dlp stderr tail as `detail`.

## yt-dlp (YouTube, Drive and direct video links)

YouTube serves DASH-segmented streams — separate audio and video behind signed URLs — so the
`.mp4`-capture flow gets nothing usable; yt-dlp resolves the manifest, downloads both tracks and
muxes them. `-f bv*[height<=720]+ba/b[height<=720]/b` caps the video at 720p — the pipeline keeps
only the audio and nothing plays the video, so a higher resolution is pure size; the trailing `/b`
keeps Drive and generic URLs, whose formats often carry no height. `-o video.%(ext)s
--merge-output-format mp4 --remux-video mp4` lands `video.mp4` — the remux covers a lone
`.webm`/`.mkv` that needs no merge, which would otherwise land under its own extension and fail
the upload; `--no-progress --quiet` keeps it silent; `--cache-dir <state>/ytdlp-cache` because the
default home may be read-only. Packaged, `--ffmpeg-location` names the bundled ffmpeg, which is not
on PATH: without it yt-dlp skips the merge yet exits 0, leaving only `video.fNNN.*` and no
`video.mp4` to upload.

`/download-youtube` gates on `YTDLP_HOST_RE`. `/download-url` (the manual form) takes any http(s)
URL but first asks auto/'s `/resolve` with it, unmarked: a link off the configured Moodle site comes
back as this descriptor with no cookies or headers, one on it as a `curl` target on auto's
`/moodle/file/<id>`, so auto stays the only process that talks to Moodle
([GATE.md](../../auto/docs/GATE.md#files)). auto's refusals (`429 moodle_busy`, `422
link_not_a_video`, …) are forwarded verbatim, and an unreachable auto fails the click `502
autodl_unreachable` whatever the link. The job has no ref; a proxied target whose id auto forgot (a restart) re-resolves once from the
same url, waiting its turn at the lock, like a row's silent re-resolve ([JOBS.md](JOBS.md)). yt-dlp's generic
extractor rarely knows a size, so the probe usually reports unknown, and a host's 401/403 lands as
`download_auth_failed` like any other source.

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
so every spawn site and the `/tools` probe follow it unaware.

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
  the tool probe: it swaps the exe in place, and a probe landing in that window would pin `/tools` at
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

yt-dlp path: `--skip-download --print %(filesize,filesize_approx)s` over the same 720p-capped
`-f` selection the download uses, summed. It needs the JS-runtime flags too, or it resolves "unknown".
