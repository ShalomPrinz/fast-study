# App harness

Agent tooling, not app code. It runs the real four services and the real SPA with every third party
replaced by a local fake, so an agent can develop against, verify, or debug real user flows without
a real key, a real account, MFA, or any traffic off loopback. Each harness root is a private stack
on its own ports, so several agents run side by side without sharing data. The `app-harness` skill
is the entry point, `/hunt-bugs` builds its wave on it, and nothing in the app imports it.

```bash
node .claude/harness/setup.mjs                 # build, launch, prove, stay up (Ctrl-C stops all)
node .claude/harness/setup.mjs --harness DIR   # put the scratch root somewhere specific
node .claude/harness/setup.mjs --browsers main,other   # also one browser session per named tag
node .claude/harness/setup.mjs --harness DIR --down                          # stop that stack, exit
node .claude/harness/setup.mjs --harness DIR --restart <service> [ENV=val…]  # restart one service
node .claude/harness/setup.mjs --reseed        # start from the baseline and the fixtures again
node .claude/harness/setup.mjs --no-launch     # fakes + fixtures only, print where the env files are
node .claude/harness/setup.mjs --skip-pipeline-check   # skip the slowest self-check
```

## Ports

Every service, fake and browser session listens on a port this harness root took for itself,
recorded in `<harness>/ports.json`; nothing is on a default dev port, so a plain `npm run dev` and
any number of other harnesses run beside it. A re-run on the same root takes the same ports back
when all are still free, so links the seed wrote stay valid, and a fresh set otherwise.

```bash
node .claude/harness/hb.mjs --harness DIR url             # every name and its URL
node .claude/harness/hb.mjs --harness DIR url providers   # one, e.g. for curl $(hb url providers)/control
```

Names: `database`, `backend`, `server` (downloader), `auto`, `frontend`, `providers`, `site`,
`siteTls`, and `browser-<tag>` per session. The services learn their own port from
`FASTSTUDY_PORT` or `--port`, their peers' from `DATABASE_URL`, `BACKEND_URL`, `AUTODL_URL` and
`FRONTEND_URL`, and the SPA its services' from `VITE_*_URL` — all passed by `setup.mjs`. Open the
app at `http://localhost:<frontend>`: in dev (`FASTSTUDY_SECRET` unset) every service's CORS takes
any `http://localhost` port, and `127.0.0.1` is not that origin.

A second `setup.mjs` on a root whose setup is still alive refuses to start; use that stack, or
`--down` it first.

`setup.mjs` stays in the foreground holding the stack, and records each service's exact spawn spec
(command, cwd, full environment) and process group in `<harness>/stack.json`. Ctrl-C, `--down` and
`--restart` all act on that record — browser sessions included, killing whole process groups — the `uv`/`npm` parent with the
server it wraps — so nothing is found by port or by `pkill -f`. `--restart` takes a service name as
recorded (`fake-providers`, `fake-site`, `database`, `backend`, `downloader-server`,
`downloader-auto`, `frontend`), lays any `ENV=val` over its recorded environment, notes the restart
in that service's log and waits for its health URL. A restarted `backend` or `database` then gets the
scratch `.env`'s current settings pushed through `POST /config` (`downloader-auto` too, for
`MOODLE_SITE`), since its recorded environment is the boot one — so `hb set`, `hb wall` and a reseed survive it, and an `ENV=val` given still wins. `--down` also ends a setup still holding the
foreground. Both need the same `--harness` (or `HARNESS_DIR`) the stack was started with.

Re-running against the same harness directory keeps the data the last run left, which is usually
what you want when chasing a bug; `--reseed` (or `hb reseed` on a live stack) starts from the
baseline again.

## The baseline, and one course per flow

A seed wipes both scratch roots and restores everything a flow can change: the scratch `.env` (fake
keys, the backend's first `/config/options` model, Drive on under `Harness`, `AUTO_RUN=full`, nightly off at hour 3,
`MOODLE_SITE=https://lemida.biu.ac.il`) pushed to the running backend, database and auto-downloader through
`POST /config`, the Moodle token (after
`/auth/disconnect`, the only thing that clears the auto-downloader's in-memory "expired"), both
fakes' modes, the fake Drive store, and Drive **connected**. It then seeds, through `database/`'s
routes, one course per flow so parallel agents on one stack never share data. The courses are
named for `/hunt-bugs`' flows, and any task can use them as ready-made fixtures:

| Course         | For                           | What it holds                                                                 |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `hb-mgmt`      | course and lecture management | a video lecture, `שיעור 10` / `שיעור 10 - המשך`, a very long name, a Latin name, a recitation |
| `hb-dl`        | downloads                     | the fake site as `source_url`; `שיעור 1` has a video, so recording 1 reads as downloaded |
| `hb-edit`      | editor and PDF                | three lectures with video, transcript and `summary.md`                        |
| `hb-nav`       | search, materials, links      | `שיעור 1` finished (fixture `summary.pdf`, `drive_url.txt`, a material), `שיעור 2` summarised with a material, one empty |
| `hb-pipeline`  | pipeline and course overview  | one lecture per stage, two video-only for queue + lock, a recitation          |
| `hb-fail`      | failure surfacing             | video-only, transcribed and summarised lectures to fail at each step          |
| `hb-selfcheck` | the self-check's pipeline run | not a flow's — leave it alone                                                 |

The seeded `drive_url.txt` points at the fake providers' `/drive/view/…`, a page the fake providers serve,
so "Open in Drive" never leaves the machine. `<harness>/data-empty` is a second marked root, empty
after every seed, for the data-folder switch.

The backend's in-memory job history and queue survive a live reseed; reseed between tasks, not
mid-run, or restart `backend` for a clean runner.

## `hb` — helpers against a live stack

```bash
export HARNESS_DIR=DIR                          # or pass --harness DIR to each call
node .claude/harness/hb.mjs help              # every subcommand, one line each
node .claude/harness/hb.mjs url [name]        # this stack's URLs, or one of them
node .claude/harness/hb.mjs set AUTO_RUN=off  # save settings by .env name, as the settings screen does
node .claude/harness/hb.mjs reseed            # the baseline and the flow courses, stack left running
node .claude/harness/hb.mjs state             # save <harness>/state.json, print what moved since the seed
node .claude/harness/hb.mjs wall              # blank DATA_ROOT, both keys and MOODLE_SITE: reload shows the first-run screen
node .claude/harness/hb.mjs unwall            # put them back to the baseline
node .claude/harness/hb.mjs add-material hb-nav 'שיעור 3' [file.pdf]  # attach a material, notify
node .claude/harness/hb.mjs rm-lecture hb-pipeline 'שיעור 4'          # delete its folder, notify
node .claude/harness/hb.mjs lock 'hb-fail/שיעור 3/summary.pdf'       # held open, Windows-style
node .claude/harness/hb.mjs unlock            # every lock off (or name the globs to drop)
node .claude/harness/hb.mjs forget-probes     # every probed link back to unprobed ('?')
node .claude/harness/hb.mjs refused --since 2026-09-25T09:00Z        # real escapes only
node .claude/harness/hb.mjs browser dl        # one more browser session, stopped by --down
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
every lecture. Reads still succeed, as they do past a viewer's lock. Renaming any folder with a
matching path at any depth beneath it — the lecture or its course — fails as Windows fails it,
`PermissionError` `winerror` 5 `[WinError 5] Access is denied: 'old' -> 'new'`, and the shim tells
the database's `fs.crud` alone that it runs on `win32`, so that becomes its real `423 folder_in_use`. The globs live in
`<harness>/locks.json`, are read on each call, show in `hb state`, and `hb reseed` clears them.

`forget-probes` restarts `downloader-auto`, whose probe verdicts and replayed captures live only in
memory, so a row it classified — the `/gone/` link as "Unsupported" — lists unprobed again and can
be driven through its first probe once more; `hb reseed` leaves both caches alone. The Downloads
page keeps the verdict it was handed until it re-lists, so reload it.

`refused` prints the `REFUSED` lines in `logs/network.log` and exits 1 when there are any. It leaves
out the self-check's two deliberate probes, which log under the service name `selfcheck`. The log
is appended across setup runs on one harness directory, so pass `--since` with the time your
work started. Both shims write it: `<time> <service> REFUSED host:port` for a refusal (`… (browser)` from one of
auto/'s browsers) and, from Node, `REDIRECT` for a connection sent to the fake site.

`set` writes the store with `PUT /settings`, then the owner's `POST /config` (`MOODLE_SITE` goes to
the auto-downloader, which forgets its token when the site changes), so the running service applies
it at once. Settings are global: `AUTO_RUN=off` (`off | audio | full`) stops every video
arrival from queuing a run, for every agent on this stack, so an agent sharing a stack sets it once
for everyone rather than for itself.

`state` diffs against `<harness>/state-seed.json`, written after each seed (after the self-check on
a setup run): fake modes, stored settings (keys as set/unset only), Drive and Moodle status, the
`hb lock` globs, and
each course's lectures with the files they hold.

`wall` edits the scratch `.env` directly for `DATA_ROOT` and `MOODLE_SITE`, because the store refuses
an empty root, and posts blank keys to the backend. The database keeps serving its root in memory and
the auto-downloader its site and token, which a real first boot would not have — so `unwall` puts
the same site back without a reconnect.

A new helper is one entry in `COMMANDS` in `hb.mjs`, with its logic in `lib/`.

## Browser sessions — `browser.mjs`

One long-running headless chromium on this stack's frontend, driven over HTTP, so an agent keeps
one page across many calls. Never write your own driver; start sessions through the harness so
`--down` stops them:

```bash
node .claude/harness/setup.mjs --harness DIR --browsers main          # at startup
node .claude/harness/hb.mjs --harness DIR browser other               # later, one more
```

A tag is any name. Each session takes a free port, recorded in `ports.json` as `browser-<tag>` (and
in `stack.json`), and logs every event to `logs/browser-<tag>.log`.

```bash
B=$(node .claude/harness/hb.mjs --harness DIR url browser-main)
curl -s $B/goto -d '{"url":"/course/hb-mgmt/overview"}'   # a path on the app (a lecture is /<course>/<lecture>), or a full URL
curl -s $B/click -d '{"selector":"text=New course"}'      # any Playwright selector
curl -s $B/fill -d '{"selector":"input[placeholder=\"Course name…\"]","value":"hb-mgmt-x"}'
curl -s $B/press -d '{"key":"Enter","screenshot":"created"}'   # on the focus, or {"selector":…}
curl -s $B/text                                           # body innerText; or {"selector":…}
curl -s $B/screenshot -d '{"name":"new-course"}'          # → evidence/mgmt-new-course.png ({"full":true})
curl -s $B/eval --data-binary 'await page.waitForTimeout(3000); return page.url()'
curl -s "$B/log?since=0"                                  # every recorded event, numbered
curl -s $B/mutations                                      # every non-GET request, with body and answer
```

A modal's buttons sit in `.modal-actions`: confirm is `.modal-actions .btn--primary`, cancel
`.modal-actions .btn--ghost`, in either language — `ConfirmModal`'s Yes/No and the passcode prompt
alike. Never pick one by text: `has-text("No")` is a case-insensitive substring that also matches
"Recitation", and the confirm button comes first in the DOM.

Arguments ride as a JSON body or query parameters, whatever the method. `/eval`'s raw body is an
async function body given `page` and `context` — the escape hatch for waits and new tabs.
`/click`, `/fill` and `/press` take an optional `screenshot` name, captured once the action settles
(half a second) into the same file `/screenshot` would write, so a toast that is gone before a
separate call still lands in the evidence.

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
| The Moodle login    | a pre-seeded WS token for the fake site, naming it as its `site`; Connect mints the same one from the fake `launch.php` | `state/auth/moodle-token.json`; auto/'s browsers, below |

The two shims (`shim/sitecustomize.py` on `PYTHONPATH`, `shim/node.mjs` through `NODE_OPTIONS`)
patch imported modules from outside. **No production file is edited, and none may be** — a mock
switch inside shipped code is exactly what `services/providers.py` keeps the base URL in its table
to avoid.

The Node shim works at the socket, not at `fetch`: the services import `spawn`, `request` and
friends as ESM named bindings, which a module-object patch cannot reach.

### auto/'s browsers

The browsers `downloader-auto` launches are processes of their own, out of the socket patch's reach,
so in that service alone the shim also patches `BrowserType.launch` in auto/'s `playwright-core`.
That one prototype covers every launch — `launchBrowser` (the login and videostream capture), the
channel probe, the zoom launcher — and rewrites each: always headless, always the chromium
`browser.mjs` picks (`channel` dropped, so the run does not depend on the box's Chrome),
`--ignore-certificate-errors` for the fake's self-signed cert, and `--host-resolver-rules` mapping
every host the fake site serves to its TLS port and every other name to `NOTFOUND`. Chromium honours
the port in a `MAP` rule, so no proxy is needed; the cost is that a plain `http://` URL to a served
host lands on the TLS port and fails `ERR_EMPTY_RESPONSE` — every fixture URL is https. A browser
cannot write `network.log`, so each context it opens logs an http(s) request that failed
`ERR_NAME_NOT_RESOLVED` as `downloader-auto REFUSED host:port (browser)`.

So Connect runs auto/'s real login: the fake site answers `launch.php` with a 302 to
`moodlemobile://token=…` carrying `FAKE_WSTOKEN`, auto/ captures it, and Done calls site info
through the Node shim, where the site's `/control` modes apply unchanged. There is no window to
finish; press Done any time after Connect.

Videostream capture launches through the same patch, so its browser is offline, but it has nothing
to run against: the fake course lists no `videostream` activity, and the site serves neither
`autologin.php` nor a `view.php` page whose `<video>` requests an `.mp4`. Those three are what adding it takes.

## The guarantees, each proved before handover

`setup.mjs` aborts unless all of these hold, because a silently broken shim costs more than no
harness: the fakes answer; a Python process and a Node process are both refused off loopback, the
Python refusal logged in `network.log`, while
the fake site still serves a redirected `https://lemida.biu.ac.il`, and auto/'s `POST /site/probe`
reads it as `supported` with the seeded token connected; both services log the harness
keys (the repo `.env` lost the `load_dotenv` race); a settings save lands in the scratch `.env` and
leaves the real one untouched; Connect → Done through auto/'s real login and browser saves the fake
token, `missing_function` refuses it with `422 missing_function`, and no browser escapes; every `/control` mode of both fakes, a targeted rule and a draining
one each change the answer they should and switch back; Drive disconnects and reconnects through
the backend's routes, left connected; the app, loaded in headless chromium from this stack's
frontend, lists every non-archived course and reaches each service's `/health` from that origin, so
a CORS allowlist that refuses its port, or a SPA pointed at another stack, fails here
(`evidence/selfcheck-app.png`);
and `audio` (real ffmpeg) → `transcribe` (fake Groq) runs green.

`DATA_ROOT` is a tree the harness made, marked with `.harness-scratch`; it refuses to run against
a data root without that marker.

## Driving failures

The fakes take a mode, so the quota and outage flows need no real quota:

```bash
P=$(node .claude/harness/hb.mjs url providers); S=$(node .claude/harness/hb.mjs url site)
curl -s $P/control -d '{"gemini":"429"}'   # every call; groq: ok | 429 | 500 | empty
curl -s $P/control -d '{"gemini":"invalidkey"}'  # gemini also: invalidkey
curl -s $P/control -d '{"gemini":{"mode":"429","match":"hb-fail/שיעור 4","times":1}}'
curl -s $P/control -d '{"groq":{"mode":"slow","ms":20000,"match":"hb-pipeline/שיעור 4"}}'  # held, then ok
curl -s $P/control -d '{"reset":true}'     # every provider back to ok
curl -s $S/control -d '{"mode":"blocked"}' # ok | blocked | invalidtoken | not_moodle | mobile_service_off | missing_function | downloads_disabled
curl -s $S/control -d '{"downloadMs":60000}' # how long each download takes (3000)
curl -s $S/control -d '{"reset":true}'     # mode ok, 3000 ms, every /die/ re-armed
```

The site's last four modes are a site auto/ must refuse. `not_moodle` answers the probe's
`service-nologin.php` with a 404 page and `mobile_service_off` with `enablemobilewebservice: 0` — the
pre-login probe (the settings field) says `unsupported`. `missing_function` drops
`core_course_get_contents` from site info and `downloads_disabled` sets `downloadfiles: 0`, which only
the post-login check reads — Settings → University account → Connect → Done shows its refusal. An unknown mode is answered 400.

A provider's rule is `{mode, match, times}`; a bare string is `{mode}`, every call. Nothing the
SDKs send names the lecture, so the shim stamps each call a pipeline step or an overview makes with
an `x-harness-lecture` header — its path, `course/lecture` or `course/Recitations/name`, or the
course alone for an overview — and `match` hits when its whole segments appear there: `hb-fail`
is that course, `שיעור 4` that name in any course, never `שיעור 40`. A key probe carries no path,
so only an untargeted rule reaches it. `times` counts the calls the rule failed (one per Groq
chunk, one per Gemini request) and puts the provider back to `ok` at zero. A mode applies where it
means something: `429` and `empty` to transcription and generation, `500` there and to the key
probe, `invalidkey` to every Gemini route — the real 400 `API_KEY_INVALID` body, so the first
upload of a run is what fails. `slow`, on transcription and generation, holds each matched call
`ms` and then answers as `ok` — a step that stays in flight long enough to cancel, rename, reload or
queue behind; Groq is held once per chunk, so a lecture's step takes `ms` × its chunks. The Drive
upload is an in-process fake in the backend, outside `/control`, so it has no `slow`. An unknown
mode or field is answered 400. `/health` shows each rule
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
quota accounting, a real site's SSO and MFA pages (the fake `launch.php` redirects at once), the
zoom login, zoom capture (it needs a real browser), videostream capture (see below), and Google Drive's own semantics beyond create/update.
