# hunt-bugs harness

Agent tooling, not app code. It runs the real four services and the real SPA with every third party
replaced by a local fake, so a bug hunt can take real user flows without a real key, a real account,
MFA, or any traffic off loopback. `/hunt-bugs` drives it; nothing in the app imports it.

```bash
node .claude/hunt-bugs/setup.mjs                 # build, launch, prove, stay up (Ctrl-C stops all)
node .claude/hunt-bugs/setup.mjs --harness DIR   # put the scratch root somewhere specific
node .claude/hunt-bugs/setup.mjs --browsers mgmt,nav     # also one browser session per named flow
node .claude/hunt-bugs/setup.mjs --stop          # kill whatever holds the ports first, then start
node .claude/hunt-bugs/setup.mjs --harness DIR --down                          # stop that stack, exit
node .claude/hunt-bugs/setup.mjs --harness DIR --restart <service> [ENV=val…]  # restart one service
node .claude/hunt-bugs/setup.mjs --reseed        # start from the baseline and the fixtures again
node .claude/hunt-bugs/setup.mjs --no-launch     # fakes + fixtures only, print where the env files are
node .claude/hunt-bugs/setup.mjs --skip-pipeline-check   # skip the slowest self-check
```

It refuses to start when any of its ports is already listening — a previous harness or a plain
`npm run dev` would answer `/health` and pass for this run's stack, with someone else's data root
behind it. `--stop` terminates them first, and only processes it recognises as FastStudy's.

`setup.mjs` stays in the foreground holding the stack, and records each service's exact spawn spec
(command, cwd, full environment) and process group in `<harness>/stack.json`. Ctrl-C, `--down` and
`--restart` all act on that record — browser sessions included, killing whole process groups — the `uv`/`npm` parent with the
server it wraps — so nothing is found by port or by `pkill -f`. `--restart` takes a service name as
recorded (`fake-providers`, `fake-site`, `database`, `backend`, `downloader-server`,
`downloader-auto`, `frontend`), lays any `ENV=val` over its recorded environment, notes the restart
in that service's log and waits for its health URL. `--down` also ends a setup still holding the
foreground. Both need the same `--harness` (or `HUNT_BUGS_HARNESS`) the stack was started with.

Re-running against the same harness directory keeps the data the last sweep left, which is usually
what you want when chasing a bug; `--reseed` (or `hb reseed` on a live stack) starts from the
baseline again.

## The baseline, and one course per flow

A seed wipes both scratch roots and restores everything a flow can change: the scratch `.env` (fake
keys, `gemini-2.5-flash`, Drive on under `HuntBugs`, `AUTO_RUN=full`, nightly off at hour 3) pushed
to the running backend and database through `POST /config`, the Moodle token (after
`/auth/disconnect`, the only thing that clears the auto-downloader's in-memory "expired"), both
fakes' modes, the fake Drive store, and Drive **connected**. It then seeds, through `database/`'s
routes, one course per flow so parallel flows never share data:

| Course         | For                           | What it holds                                                                 |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `hb-mgmt`      | course and lecture management | a video lecture, `שיעור 10` / `שיעור 10 - המשך`, a very long name, a Latin name, a recitation |
| `hb-dl`        | downloads                     | the fake site as `source_url`; `שיעור 1` has a video, so recording 1 reads as downloaded |
| `hb-edit`      | editor and PDF                | three lectures with video, transcript and `summary.md`                        |
| `hb-nav`       | search, materials, links      | `שיעור 1` finished (fixture `summary.pdf`, `drive_url.txt`, a material), `שיעור 2` summarised with a material, one empty |
| `hb-pipeline`  | pipeline and course overview  | one lecture per stage, two video-only for queue + lock, a recitation          |
| `hb-fail`      | failure surfacing             | video-only, transcribed and summarised lectures to fail at each step          |
| `hb-selfcheck` | the self-check's pipeline run | not a flow's — leave it alone                                                 |

The seeded `drive_url.txt` points at `localhost:4598/drive/view/…`, a page the fake providers serve,
so "Open in Drive" never leaves the machine. `<harness>/data-empty` is a second marked root, empty
after every seed, for the data-folder switch.

The backend's in-memory job history and queue survive a live reseed; reseed between waves, not
mid-run, or restart `backend` for a clean runner.

## `hb` — helpers against a live stack

```bash
export HUNT_BUGS_HARNESS=DIR                    # or pass --harness DIR to each call
node .claude/hunt-bugs/hb.mjs help              # every subcommand, one line each
node .claude/hunt-bugs/hb.mjs set AUTO_RUN=off  # save settings by .env name, as the settings screen does
node .claude/hunt-bugs/hb.mjs reseed            # the baseline and the flow courses, stack left running
node .claude/hunt-bugs/hb.mjs state             # save <harness>/state.json, print what moved since the seed
node .claude/hunt-bugs/hb.mjs wall              # blank DATA_ROOT and both keys: reload shows the first-run screen
node .claude/hunt-bugs/hb.mjs unwall            # put them back to the baseline
node .claude/hunt-bugs/hb.mjs add-material hb-nav 'שיעור 3' [file.pdf]  # attach a material, notify
node .claude/hunt-bugs/hb.mjs rm-lecture hb-pipeline 'שיעור 4'          # delete its folder, notify
node .claude/hunt-bugs/hb.mjs lock 'hb-fail/שיעור 3/summary.pdf'       # held open, Windows-style
node .claude/hunt-bugs/hb.mjs unlock            # every lock off (or name the globs to drop)
node .claude/hunt-bugs/hb.mjs refused --since 2026-09-25T09:00Z        # real escapes only
node .claude/hunt-bugs/hb.mjs browser dl [--port N]  # one more browser session, stopped by --down
node .claude/hunt-bugs/hb.mjs brief dl [focus…]       # a flow agent's brief: brief.md filled in
node .claude/hunt-bugs/hb.mjs findings sweep 2026-09-25  # fragments/*.md → findings-sweep-2026-09-25.md
```

A lecture argument is its folder name, or `Recitations/<name>` for a recitation.

`add-material` posts the PDF (the handout fixture by default) to the database's materials route and
then `POST /notify`, as the downloader does — the database announces none of its own writes, so a
caller that skips the notify leaves an open page stale. The app has no UI for attaching one.

`rm-lecture` deletes the folder under the database's current root directly, since no route deletes
a lecture, and only when that root carries the scratch marker; then it notifies. Use it mid-run to
see what a pipeline step, the editor or an open page does when its lecture vanishes.

`lock` stands in for a PDF viewer holding a file open, which Windows enforces and Linux never does.
Inside the database process the shim fails every write-mode open, delete and rename of a path
matching a glob with the `PermissionError` Windows raises (`winerror` 32), so the database's own
classifier turns it into its real `423 file_locked`, and the backend's pipeline error carries that
code. A glob matches the tail of the path — `hb-fail/שיעור 3/summary.pdf`, or `*/summary.pdf` for
every lecture. Reads still succeed, as they do past a viewer's lock. Only the file itself is locked:
renaming its lecture folder, which Windows would also refuse, still succeeds. The globs live in
`<harness>/locks.json`, are read on each call, show in `hb state`, and `hb reseed` clears them.

`refused` prints the `REFUSED` lines in `logs/network.log` and exits 1 when there are any. It leaves
out the self-check's two deliberate probes, which log under the service name `selfcheck`. The log
is appended across setup runs on one harness directory, so pass `--since` with the time a wave
started. Both shims write it: `<time> <service> REFUSED host:port` for a refusal and, from Node,
`REDIRECT` for a connection sent to the fake site.

`set` writes the store with `PUT /settings`, then the owner's `POST /config`, so the running service
applies it at once. Settings are global: `AUTO_RUN=off` (`off | audio | full`) stops every video
arrival from queuing a run, for every flow, so set it once for the wave rather than inside one flow.

`state` diffs against `<harness>/state-seed.json`, written after each seed (after the self-check on
a setup run): fake modes, stored settings (keys as set/unset only), Drive and Moodle status, the
`hb lock` globs, and
each course's lectures with the files they hold.

`wall` edits the scratch `.env` directly for `DATA_ROOT`, because the store refuses an empty root,
and posts blank keys to the backend. The database keeps serving its root in memory, which a real
first boot would not have.

`brief` prints [`brief.md`](brief.md) with this harness's paths and the flow's sweep items, course
and browser port filled in (`FLOWS`, `lib/env.mjs`). Extra words narrow the flow. `brief.md` is also
the only definition of the fragment format, which each flow agent writes to `fragments/<tag>.md`.

`findings <area> <date>` parses every fragment and writes `findings-<area>-<date>.md` at the repo
root, or at `--out FILE`. It will not overwrite an existing file. It checks every fragment before
writing anything, and a malformed fragment fails the merge with each `file:line` and the rule it
breaks. That covers a missing section or field, an unknown field, a Severity outside
`critical | major | minor | cosmetic`, a Lands in with no `path:line`, and a stray unindented line,
so no finding is dropped silently. The output holds:

- the harness root and the flows merged;
- the `state-seed.json` → `state.json` diff, which is why `hb state` runs first;
- the known flows with no fragment;
- a summary table numbered by severity;
- the **Overlaps across flows** list, meaning the same `path:line` in the Lands in of findings from
  two or more flows;
- each fragment verbatim, its `####` headings numbered to match the table.

Overlaps are only flagged, never merged. Deciding what counts as one bug is left to the orchestrator.

A new helper is one entry in `COMMANDS` in `hb.mjs`, with its logic in `lib/`.

## Browser sessions — `browser.mjs`

One long-running headless chromium on `http://localhost:5173`, driven over HTTP, so a flow keeps
one page across many calls. Never write your own driver; start sessions through the harness so
`--down` stops them:

```bash
node .claude/hunt-bugs/setup.mjs --harness DIR --browsers mgmt,dl,edit,nav   # at startup
node .claude/hunt-bugs/hb.mjs --harness DIR browser pipeline                 # later, one more
```

Each is recorded in `stack.json` as `browser-<tag>` and logs every event to `logs/browser-<tag>.log`.
Known tags and ports (`BROWSER_PORTS`, `lib/env.mjs`): `mgmt` 4710, `dl` 4711, `edit` 4712, `nav`
4713, `pipeline` 4714, `fail` 4715, `settings` 4716; another tag needs `--port N`.

```bash
B=http://127.0.0.1:4710
curl -s $B/goto -d '{"url":"/hb-mgmt"}'                   # a path on the app, or a full URL
curl -s $B/click -d '{"selector":"text=New course"}'      # any Playwright selector
curl -s $B/fill -d '{"selector":"input[placeholder=\"Course name…\"]","value":"hb-mgmt-x"}'
curl -s $B/text                                           # body innerText; or {"selector":…}
curl -s $B/screenshot -d '{"name":"new-course"}'          # → evidence/mgmt-new-course.png ({"full":true})
curl -s $B/eval --data-binary 'await page.keyboard.press("Enter"); return page.url()'
curl -s "$B/log?since=0"                                  # every recorded event, numbered
curl -s $B/mutations                                      # every non-GET request, with body and answer
```

Arguments ride as a JSON body or query parameters, whatever the method. `/eval`'s raw body is an
async function body given `page` and `context` — the escape hatch for keys, waits and new tabs.

Each answer ends with any console error or warning, page error, 4xx/5xx or failed request that
happened while the command ran, so a click's fallout arrives with it. `/log` also holds the rest:
all console output and every API request (fetch, xhr, EventSource, document) with its status.
Every non-GET request is appended to `evidence/<tag>-mutations.jsonl` with its body (a binary
upload as its size) and the service's answer, which outlives the session.

After each click the mouse leaves the page, so a tooltip or toast opened under the pointer never
covers the next target. An unexpected native dialog is logged and dismissed — the app uses none.
Chromium runs with every host name but loopback unresolvable, so the page is as offline as the
services; a link off the machine fails as `failed … ERR_NAME_NOT_RESOLVED` in the log.

The browser is the newest `chromium_headless_shell-*` (else `chromium-*`) in `~/.cache/ms-playwright`
(or `PLAYWRIGHT_BROWSERS_PATH`), not the revision downloader/auto's Playwright pins, which is often
not installed. Playwright itself is loaded from `downloader/auto/node_modules`.

**Nothing a run shows you is real.** Transcripts, summaries, downloads, course listings and Drive
uploads are fixtures. A conclusion about how the app behaves against a real provider, a real lecture
site or real data cannot be drawn from here.

## What is faked, and how

| Third party         | Faked by                                                              | Attached through                               |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Groq, Gemini        | `fakes/providers.mjs` — both wire formats, real SDKs reach it         | `services.providers`' base URLs, rewritten     |
| Google Drive        | an in-process fake service writing `drive/store.json` + `ops.jsonl`   | `googleapiclient.discovery.build`, replaced    |
| Drive OAuth consent | a pending → connected flow with no browser and no account            | `services.google_auth`, four functions replaced |
| The lecture site    | `fakes/site.mjs` — Moodle WS, pluginfile PDFs, media, over http + TLS | every non-loopback socket, redirected          |
| `curl`, `yt-dlp`    | `fakes/tool.mjs` — writes the fixture the URL names (PDF or video) in slices, asking the fake site only for its live settings | first on `PATH`, where `toolPath()` looks      |
| The Moodle login    | a pre-seeded WS token in the state root                               | `state/auth/biu-token.json`                    |

The two shims (`shim/sitecustomize.py` on `PYTHONPATH`, `shim/node.mjs` through `NODE_OPTIONS`)
patch imported modules from outside. **No production file is edited, and none may be** — a mock
switch inside shipped code is exactly what `services/providers.py` keeps the base URL in its table
to avoid.

The Node shim works at the socket, not at `fetch`: the services import `spawn`, `request` and
friends as ESM named bindings, which a module-object patch cannot reach.

## The guarantees, each proved before handover

`setup.mjs` aborts unless all of these hold, because a silently broken shim costs more than no
harness: the fakes answer; a Python process and a Node process are both refused off loopback, the
Python refusal logged in `network.log`, while
the fake site still serves a redirected `https://lemida.biu.ac.il`; both services log the harness
keys (the repo `.env` lost the `load_dotenv` race); a settings save lands in the scratch `.env` and
leaves the real one untouched; every `/control` mode of both fakes, a targeted rule and a draining
one each change the answer they should and switch back; Drive disconnects and reconnects through
the backend's routes, left connected; the app, loaded in headless chromium from
`http://localhost:5173`, lists every non-archived course and reaches each service's `/health` from
that origin, so a CORS allowlist that does not name it fails here (`evidence/selfcheck-app.png`);
and `audio` (real ffmpeg) → `transcribe` (fake Groq) runs green.

`DATA_ROOT` is a tree the harness made, marked with `.hunt-bugs-scratch`; it refuses to run against
a data root without that marker.

## Driving failures

The fakes take a mode, so the quota and outage flows need no real quota:

```bash
curl -s localhost:4598/control -d '{"gemini":"429"}'   # every call; groq: ok | 429 | 500 | empty
curl -s localhost:4598/control -d '{"gemini":"invalidkey"}'  # gemini also: invalidkey
curl -s localhost:4598/control -d '{"gemini":{"mode":"429","match":"hb-fail/שיעור 4","times":1}}'
curl -s localhost:4598/control -d '{"reset":true}'     # every provider back to ok
curl -s localhost:4599/control -d '{"mode":"blocked"}' # ok | blocked | invalidtoken
curl -s localhost:4599/control -d '{"downloadMs":60000}' # how long each download takes (3000)
curl -s localhost:4599/control -d '{"reset":true}'     # mode ok, 3000 ms, every /die/ re-armed
```

A provider's rule is `{mode, match, times}`; a bare string is `{mode}`, every call. Nothing the
SDKs send names the lecture, so the shim stamps each call a pipeline step or an overview makes with
an `x-hunt-bugs-lecture` header — its path, `course/lecture` or `course/Recitations/name`, or the
course alone for an overview — and `match` hits when its whole segments appear there: `hb-fail`
is that course, `שיעור 4` that name in any course, never `שיעור 40`. A key probe carries no path,
so only an untargeted rule reaches it. `times` counts the calls the rule failed (one per Groq
chunk, one per Gemini request) and puts the provider back to `ok` at zero. A mode applies where it
means something: `429` and `empty` to transcription and generation, `500` there and to the key
probe, `invalidkey` to every Gemini route — the real 400 `API_KEY_INVALID` body, so the first
upload of a run is what fails. An unknown mode or field is answered 400. `/health` shows each rule
and `hb state` diffs it field by field.

Any key containing `bad` gets 401 on every route whatever the mode — what Groq sends for an unknown
key; type one into the settings screen for the rejected-key path.

Each fake's fields set only themselves; `hb reseed` sends both resets, and the providers' also
restarts the fake transcript at its first paragraph. `downloadMs` is read by the
fake tool as each download starts, so a slow download for "reload mid-download" needs no restart.

The fake course has a row per failure, each a URL switch (titles in `FAILURE_ROWS`, `lib/env.mjs`;
the self-check proves all three are listed):

- `/gone/` — the site answers 404, so the resolve probe calls the link dead before any download.
- `/deny/` — probes as a video, then the tool fails 403. The first download is a fresh capture and
  fails "authentication failed"; the retry replays auto's cached cap, so its 403 drives the
  downloader's one silent re-resolve, which fails again (logged `♻️` in `downloader-server.log`).
- `/die/` — the tool drops the connection halfway the first time per URL, until a reset; the
  retry succeeds.

## Inspecting a PDF

The box has no `pdftotext` or `pdftoppm`. PyMuPDF is a backend dependency, so read text and render
pages through the backend's environment:

```bash
cd backend && uv run python -c "import fitz, sys; d = fitz.open(sys.argv[1]); print(d[0].get_text())" FILE.pdf
cd backend && uv run python -c "import fitz, sys; fitz.open(sys.argv[1])[0].get_pixmap(dpi=110).save(sys.argv[2])" FILE.pdf page1.png
```

Open the PNG to check the Hebrew RTL layout by eye; `get_text()` returns the logical order.

## Blind spots

The Electron shell and the installer (this is the dev stack), real provider behaviour and real
quota accounting, the headed Moodle and zoom logins with MFA, zoom capture (it needs a real
browser), and Google Drive's own semantics beyond create/update.
