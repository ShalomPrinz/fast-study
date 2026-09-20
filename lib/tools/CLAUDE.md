# lib/tools

How every external binary is spawned, in both languages. `tools.py` serves `backend/`;
`tools.js` serves `downloader/server` and `downloader/auto`.

## The contract

**`FASTSTUDY_BIN_DIR` names the directory the launcher put the bundled binaries in.** Unset means
dev: `tool_path` / `toolPath` hands back the bare name and PATH resolves it. Set means packaged:
every tool is spawned by absolute path into that directory, never off PATH, so a stray `ffmpeg`
earlier in a user's PATH can never be picked up instead of the one that shipped.

`.exe` is appended on Windows and nowhere else. That is derived from the *platform*, not from the
env var — a bin dir on Linux holds suffix-less names, and the packaged build is Windows-only anyway.

It lives in `lib/` because the launcher writes the variable and both languages must read it — and
the `.exe` rule — identically; see the admission rule in [`../CLAUDE.md`](../CLAUDE.md). That is why
the Python half is here with one consumer.

## Nuances

- **`curl` is deliberately not bundled.** Windows 10+ ships `curl.exe`, so `toolPath('curl')` returns
  the bare name even when a bin dir is set. It is the one exception to "never PATH" and it is
  encoded in `SYSTEM_TOOLS` / `_SYSTEM_TOOLS` rather than left to each caller to remember.
- **`yt-dlp` resolves to the per-user copy when there is one.** In a packaged run `toolPath('yt-dlp')`
  returns `statePath('bin', 'yt-dlp')` if that file exists, because yt-dlp updates itself and the
  install directory is read-only and replaced wholesale by an app update. The branch sits *inside*
  the `FASTSTUDY_BIN_DIR` path, so with no bin dir (dev) the state root is never consulted and a
  developer's own PATH copy is never shadowed. Membership is `SELF_UPDATING_TOOLS`, so a stray file
  in the state bin dir cannot shadow `ffmpeg` or `pandoc`. JS only — Python spawns no yt-dlp — and it
  is why `js/` depends on `@faststudy/runtime` for `statePath` ([`../runtime/`](../runtime/CLAUDE.md))
  rather than re-deriving the state root.
- **`ffmpeg` needs `-version`, not `--version`.** It prints the banner for either, but `--version`
  exits 1 — there is no input file to work on — which a preflight would read as a broken binary.
  `VERSION_FLAG` carries the one exception; everything else takes the GNU spelling.
- **Every Node tool spawn spreads `NO_WINDOW` (`{ windowsHide: true }`, i.e. `CREATE_NO_WINDOW`).**
  The launcher's own `windowsHide` on the service spawn silences a console-subsystem service's
  children, which share its hidden console, but Windows ignores it for a GUI-subsystem one. Packaged,
  the Node services run as `FastStudy.exe` (GUI) with no console, so each console tool they spawn
  opens its own window unless the tool's spawn carries the flag. JS only: `services.exe` is built
  `console=True`, so the Python side needs no counterpart until `delivery/services.spec` switches to
  a windowed exe. Dev runs under `node.exe` (console) and never shows the difference.
- **`check_tools` / `checkTools` never raise.** A missing tool disables one feature (no PDF, no
  YouTube), not the service, so the result is a map of reasons for the caller to log and publish. A
  service that refused to start would take down everything it can still do.
- **A usable tool maps to the bare string `"ok"`; an unusable one maps to `{state, code, params}`.**
  `state` is the one-line developer-facing reason (`missing`, `exited 3`), `code` is its row in
  [`docs/ERROR-CODES.md`](../../docs/ERROR-CODES.md) — `tool_missing`, `tool_unusable`,
  `tool_probe_timeout`, `tool_probe_exit` — and `params` carries the values a sentence needs. Success
  stays a string on purpose: every consumer compares `!= "ok"`, and an object is never equal to it,
  so the comparison keeps its meaning while the failure side gains structure.
- **`tool_unusable`'s `detail` is opaque.** It is the OS phrase on the Python side (`Permission
  denied`) and a whole Node sentence (`Command failed: …`) on the JS side. Log it, render it, never
  pattern-match it.
- **The version probe is not a version *check*.** It answers "can this binary be spawned", nothing
  more. Pinning a particular pandoc or tectonic version is the build's job, in
  [`delivery/`](../../delivery/docs/RELEASE.md#pinned-tool-versions).
- **`py-modules = ["tools"]`** claims exactly the top-level name `tools`, which is what keeps
  `tests/` off `sys.path` beside it.

## Who reports what

Each consumer names its own tools and publishes the result on `/health` beside `status`, so the
launcher's boot screen can render a missing binary instead of the user meeting it mid-pipeline:

| Service              | Tools                                  |
| -------------------- | -------------------------------------- |
| `backend/`           | `ffmpeg`, `pandoc`, `tectonic`         |
| `downloader/server`  | `yt-dlp`, `curl`                       |
| `downloader/auto`    | `yt-dlp`                               |

`database/` spawns nothing and its `/health` stays liveness-only.

## Tests

Two suites assert the same table in both languages, so a rule that holds in one and not the other
fails here rather than in a service. A change to the table ships with a test pinning it in both,
even where it had no coverage before.

- `py/tests/test_tools.py` — `uv run --extra test pytest` from `py/`.
- `js/tests/tools.test.js` — `npm test` from `js/`.

Both write their fake binaries to whatever path `tool_path` resolves, rather than composing a
filename by hand, so the exe-suffix rule is exercised on whichever platform the suite runs on.

`NO_WINDOW` and the yt-dlp state-copy branch are JS-only, so only the JS suite covers them. It pins
the option's value, not its effect: Node ignores `windowsHide` off Windows, where CI runs.
