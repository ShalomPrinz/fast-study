# Progress rendering (`src/progress.js`)

The children run **silent** (curl `--silent`, yt-dlp `--no-progress`); the server is
the _sole_ terminal writer. Each in-flight download is registered in a module-level
`Map`, and a single shared `setInterval` (~1.5s, started on the first register,
cleared when the registry empties) polls the temp size against the probed total and
emits a line per download.

**Why not inherit the children's own bars.** Two parallel `--progress-bar` /
`--progress` children share one terminal line; their `\r` repaints stomp each other
and our `console.log`s → overwrite + flicker.

**Why two render paths.**

- **TTY** (`npm start`): repaint a compact block in place via ANSI (cursor-up +
  clear-line), tracking `paintedLines`.
- **Pipe** (`npm run dev` under `concurrently`): stdout is a pipe, not a TTY, and
  every line is prefixed `Downloader |` — ANSI cursor repaint is meaningless and
  produces garbage. Instead emit a throttled newline-terminated line (only when
  percent advanced ≥5% or ~8s elapsed); whole lines can't interleave mid-line.

`emitLog`/`emitError` route every lifecycle log through `clearPainted()` first, so a
permanent line isn't overwritten by the next repaint.

**Measuring bytes.** curl writes the lone `video.mp4` → `stat` it (`measure: 'file'`).
yt-dlp writes separate audio+video temp files and merges them, so the single output
doesn't exist mid-run → sum every file in the temp dir (`measure: 'dir'`). Percent is
clamped ≤99% until exit because yt-dlp's merge can transiently overshoot the probed sum.

Unknown probe → show a byte count + "downloading…" instead of a percentage.

The same registry entries back the job registry (`JOBS.md`), which measures bytes off them
on read — one measurement path. These bytes are terminal-only: the HTTP side pushes just
start and end, and its consumers animate a bar against an ETA.

**Error surface.** We no longer inherit child stderr, so `makeStderrTail` keeps the
last ~64 KB; a non-zero exit logs the tail (last 15 non-blank lines).
