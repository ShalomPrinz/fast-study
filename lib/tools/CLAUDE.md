# lib/tools

How every external binary is spawned, in both languages. `tools.py` serves `backend/`;
`tools.js` serves `downloader/server` and `downloader/auto`.

## The contract

**`FASTSTUDY_BIN_DIR` names the directory the launcher put the bundled binaries in.** Unset means
dev: `tool_path` / `toolPath` hands back the bare name and PATH resolves it, exactly as the code did
before this module existed. Set means packaged: every tool is spawned by absolute path into that
directory, never off PATH, so a stray `ffmpeg` earlier in a user's PATH can never be picked up
instead of the one that shipped.

`.exe` is appended on Windows and nowhere else. That is derived from the *platform*, not from the
env var — a bin dir on Linux holds suffix-less names, and the packaged build is Windows-only anyway.

## Why this is in lib/ and not in each service

The bin directory is a cross-language wire fact, the same kind as `FASTSTUDY_STATE_DIR` in
[`../runtime/`](../runtime/CLAUDE.md): the launcher writes it once and both languages have to read it
the same way. Python and JS disagreeing on the variable name or on the `.exe` rule is not a
stylistic difference, it is a build that cannot spawn its own tools. That is the admission rule in
[`../CLAUDE.md`](../CLAUDE.md), and it is why the Python half lives here despite having exactly one
consumer today.

## Nuances

- **`curl` is deliberately not bundled.** Windows 10+ ships `curl.exe`, so `toolPath('curl')` returns
  the bare name even when a bin dir is set. It is the one exception to "never PATH" and it is
  encoded in `SYSTEM_TOOLS` / `_SYSTEM_TOOLS` rather than left to each caller to remember.
- **`ffmpeg` and `ffprobe` need `-version`, not `--version`.** They print the banner for either, but
  `--version` exits 1 — there is no input file to work on — which a preflight would read as a broken
  binary. `VERSION_FLAG` carries the two exceptions; everything else takes the GNU spelling.
- **`check_tools` / `checkTools` never raise.** A missing tool disables one feature (no PDF, no
  YouTube), not the service, so the result is a map of reasons for the caller to log and publish. A
  service that refused to start would take down everything it can still do.
- **The version probe is not a version *check*.** It answers "can this binary be spawned", nothing
  more. Asserting a particular pandoc or tectonic version is a separate job — see
  `PANDOC_VERSION.md` at the repo root for why that guard is wanted.
- **`py-modules = ["tools"]`** claims exactly the top-level name `tools`, which is what keeps
  `tools.js`, `package.json` and `tests/` off `sys.path` despite sharing this directory.

## Who reports what

Each consumer names its own tools and publishes the result on `/health` beside `status`, so step 11's
boot screen can render a missing binary instead of the user meeting it mid-pipeline:

| Service              | Tools                                  |
| -------------------- | -------------------------------------- |
| `backend/`           | `ffmpeg`, `ffprobe`, `pandoc`, `tectonic` |
| `downloader/server`  | `yt-dlp`, `curl`                       |
| `downloader/auto`    | `yt-dlp`                               |

`database/` spawns nothing and its `/health` stays liveness-only.

## Tests

Two suites assert the same table in both languages, so a rule that holds in one and not the other
fails here rather than in a service:

- `tests/test_tools.py` — `uv run --extra test pytest` from this folder.
- `test/tools.test.js` — `npm test` from this folder.

Both write their fake binaries to whatever path `tool_path` resolves, rather than composing a
filename by hand, so the exe-suffix rule is exercised on whichever platform the suite runs on.
