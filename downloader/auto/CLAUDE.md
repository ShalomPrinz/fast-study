# CLAUDE.md — auto (auto-downloader)

A Playwright HTTP service that, given a **course URL** on the one configured Moodle site (`MOODLE_SITE`, live-updated by `POST /config`), authenticates to Moodle's Web-Services API (one headed token grab, then a long-lived stateless token), discovers the course's recordings and PDF handouts, and resolves any of them into download targets (`POST /resolve`) that `server/` fetches and turns into jobs. A **separate package** with its own `node_modules` so Playwright and its browsers never leak into `server/`'s lighter dependency set. User-facing setup: [README.md](README.md).

## Run

```bash
npm --prefix downloader/auto start   # HTTP service, app.js
npx playwright install chromium      # once, as the plain profile's fallback browser
npm --prefix downloader/auto test    # node --test, pure logic only (no browser, no network)
```

Port **3053** (`AUTODL_PORT` in the repo-root `.env`; `FASTSTUDY_PORT` in the environment wins), bound to `127.0.0.1`. CORS allows `http://localhost:5173` and `app://bundle`, plus any `http://localhost:<port>` in dev (no `FASTSTUDY_SECRET`). An installed Chrome or Edge is required for every browser profile, and zoom capture also needs `Xvfb` on Linux ([SESSIONS.md](docs/SESSIONS.md)).

Launch contract — the `FASTSTUDY_SECRET` check (`requireSecret`, every route but `GET /health`) and the state root (`statePath`, under which the Moodle token (AES-256-GCM when the launcher sets `FASTSTUDY_TOKEN_KEY`, [AUTH.md](docs/AUTH.md)), the zoom passcode store and the yt-dlp cache live) — comes from [`@faststudy/runtime`](../../lib/runtime/CLAUDE.md). `yt-dlp` resolves through [`@faststudy/tools`](../../lib/tools/CLAUDE.md) and is probed once at startup and reported on `GET /tools`, which answers once that probe settles; `/health` never waits on it. It only runs `--flat-playlist`, which never touches YouTube's player script, so it carries none of `server/`'s JS-runtime flags.

Errors go to Sentry only when the launcher sets `FASTSTUDY_SENTRY_DSN`: `instrument.js`, app.js's first import, inits with [`@faststudy/sentry`](../../lib/sentry/CLAUDE.md)'s scrubbing options, and Sentry's express handler sits before the backstop. An extractor fault that reaches the 500 backstop is an event, its stack naming the extractor; the typed 401/409/422/503 answers are not. The one deliberate message is `siteReport.js`'s `moodle_site_unsupported` warning, once per `(host, reason)` ([MOODLE.md](docs/MOODLE.md#checking-a-site-before-and-after-login)). Sending also needs the user's error-reports switch: `FASTSTUDY_ERROR_REPORTS=1` at launch, then `POST /config {error_reports}` flips it live through the gated transport — never a re-init.

## HTTP surface

**One Moodle request at a time** ([GATE.md](docs/GATE.md)): every route that can reach the site takes a global lock at its first Moodle call and frees it 3s after it ends. A caller sending `X-FastStudy-Moodle-Wait: 1` (only `server/`'s own calls) queues; any other is refused `429 {status:'busy'}`, `moodle_busy`, before anything reaches Moodle.

Mechanism-agnostic: `/list` and `/list/expand` return uniform `Item`s whose download mechanism hides inside an opaque `ref` (base64url `Recording`); `/resolve` takes `{ ref, … }`. The `Item` fields and their meaning are in [BROWSING.md](docs/BROWSING.md).

| Endpoint                | Body                                                | Returns                                                                     |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /health`           | —                                                   | `{ status:'ok' }` at once — the launcher's wait                             |
| `GET /tools`            | —                                                   | `{ tools }` once the boot probe settles — the frontend's broken-tool toasts |
| `GET /prereqs/browser`  | —                                                   | `{ available, channel, browser, detail }` — always 200                      |
| `POST /warmup`          | —                                                   | `202 { status:'warming' }` at once — starts loading Playwright and stealth, never a browser; the launcher calls it once all four services are healthy ([SESSIONS.md](docs/SESSIONS.md)) |
| `POST /config`          | `{ moodle_site?, error_reports? }`                  | `{ status:'ok', applied }` — a different site resets auth ([AUTH.md](docs/AUTH.md)); blank clears it; `error_reports` toggles Sentry sending live |
| `POST /site/probe`      | `{ url }`                                           | `{ status:'supported'\|'unsupported'\|'unverified', site, code?, params? }` — always 200 ([MOODLE.md](docs/MOODLE.md)) |
| `GET /auth/status`      | —                                                   | `{ connected, expired, unverified }` — `unverified`: persisted after a block, site info not yet checked |
| `GET /auth/events`      | — (SSE; `?secret=` for `EventSource`)               | `data:` frame with the auth state plus `moodleBusy` on subscribe and on every change ([AUTH.md](docs/AUTH.md#connect--events--complete--status--disconnect)) |
| `POST /auth/connect`    | `{}`                                                | `{ status:'pending' }` — opens the headed window; the service then runs the login to its end itself and reports on `/auth/events` |
| `POST /auth/complete`   | —                                                   | `{ connected:true }` — re-verifies the stored `unverified` token now (not needed after a normal login); 503/422/401 as below, `moodle_login_not_pending` with none stored |
| `POST /auth/disconnect` | —                                                   | `{ connected:false }` (deletes the local token; no server-side revoke)      |
| `POST /list`            | `{ courseUrl }`                                     | `{ items }` — each Item's `moodle` says whether acting on it reaches Moodle ([BROWSING.md](docs/BROWSING.md)) |
| `POST /list/expand`     | `{ ref }`                                           | `{ items }` (one expandable item → children)                                |
| `POST /resolve`         | `{ ref, course, name, kind, only?, forceCapture? }` | `{ media, targets }`                                                        |
| `POST /zoom/passcode`   | `{ course, name?, passcode, scope }`                | `{}` (`scope:'course'\|'lecture'`)                                          |
| `POST /close`           | —                                                   | `{}` (close every persistent browser)                                       |
| `GET /moodle/file/:id`  | — (`Range` passed through)                          | a resolved file on the Moodle host (a PDF, a link, a videostream capture), streamed under the lock; `HEAD` answers its size without Moodle; `401 moodle_file_unknown` for an id this process never minted ([GATE.md](docs/GATE.md#files)) |

`/resolve` returns targets, never a download: `targets` is `[{ name, tool, url, headers?, fromCache }]` (a file on the Moodle host has a path on auto as its `url`, `/moodle/file/<id>`), one per file that will land (a zoom before/after-break pair yields `<base>.1`/`<base>.2`). `tool` (`'curl'`|`'fetch'`|`'ytdlp'`) is the key of the `server/` downloader that can fetch it; `headers` rides only with `curl`. `media` (`'video'`|`'material'`) is what actually lands — a probed row only learns it here. auto keeps no job state; `server/` creates a job per target and owns it from there ([server JOBS.md](../server/docs/JOBS.md)).

**Session replay cache** (`src/core/replayCache.js`). Every resolved cap is kept in memory keyed by its final `(course, lecture, kind, media)` target, so a retry replays it without re-capturing — never logged (caps hold cookies/tokens), unbounded (session-small). `only:true` acts on just the one named target (a zoom split name included); `forceCapture:true` bypasses the cache (and every probe cache). `fromCache` on each target tells `server/` whether an auth failure is worth one silent re-resolve. `only`+`forceCapture` re-sniffs the whole share (one zoom share yields both clips) and returns just the matching cap.

Error statuses, each a distinct signal the frontend branches on. All five carry `code` and `params`
beside the fields below, as every non-2xx body here does ([downloader CLAUDE.md](../CLAUDE.md)):

- `401 {status:'reconnect'}`, `moodle_reconnect_required` — the Moodle WS token is missing or answered `invalidtoken` ([AUTH.md](docs/AUTH.md)).
- `409 {status:'passcode', reason, course, name}`, `zoom_passcode_required {reason, course, name}` — zoom passcode `missing` or `incorrect`; save one via `/zoom/passcode` and retry ([ZOOM.md](docs/ZOOM.md)).
- `422 {status:'unsupported', message}` — the source can never be handled here (a link that probes as a non-video, non-PDF file, a web page, a dead link, an unshared Drive file). The code is the thrower's own (`link_not_a_video`, `link_dead`, `drive_not_shared`, `drive_link_malformed`, `expand_unsupported_host`), never one flat "unsupported". Memoized per probe key, so `/list` stamps `resolvedMedia:'unsupported'` ([BROWSING.md](docs/BROWSING.md)).
- `429 {status:'busy', error}`, `moodle_busy` — another Moodle request holds the lock; nothing was sent to the site. Retry once `moodleBusy` reads false ([GATE.md](docs/GATE.md)).
- `503 {status:'blocked', message}`, `site_blocked {detail}` — the Moodle site served a bot-protection challenge; transient, never retried here ([MOODLE.md](docs/MOODLE.md)). From `/auth/complete` (or the first WS call on an unverified token) the token is kept and `params.challengeWindow:true` says a headed window is open on the site root for the user to solve the challenge; then call `/auth/complete` again ([AUTH.md](docs/AUTH.md#connect--events--complete--status--disconnect)).

Two more site refusals carry no `status`: `409 moodle_site_not_configured` from `/auth/*`, `/list` and `/resolve` when no site is set, and `400 course_url_unsupported_site {url, site}` for a URL outside it. The login (and `/auth/complete`) refuses a site the post-login check rejects as `422 {status:'unsupported'}`, `moodle_site_unsupported {site, reason}` (a stored token deleted; a fresh login's capture is discarded and the stored one kept), and `/auth/complete` answers a token Moodle calls `invalidtoken` with `401 reconnect` (token deleted); the login reports the same as `moodle_reconnect_required` on the stream.

A throw carries its code up to the route through `CodedError` (`src/lib/errors.js`), which
`UnsupportedError` and `PasscodeError` extend; anything untyped reaching `app.js`'s backstop is
`internal_error {detail}`.

## Docs

| Doc                                  | Concern                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| [SESSIONS.md](docs/SESSIONS.md)      | persistent per-profile browsers, `withLock`, idle timeout, the launch matrix, the channel resolver |
| [ZOOM.md](docs/ZOOM.md)              | why zoom needs a headed, stealthed, hidden Chrome/Edge; passcode gate; before/after-break split |
| [BROWSING.md](docs/BROWSING.md)      | listing (parsers, routing, `Item`/`ref` contract), expansion, and the per-strategy resolve + probes |
| [AUTH.md](docs/AUTH.md)              | how the token provider is wired into the endpoints; expiry; on-demand autologin               |
| [GATE.md](docs/GATE.md)              | the one Moodle lock: tickets, refuse vs wait, login and challenge holds, the file proxy, `moodleBusy` |
| [MOODLE.md](docs/MOODLE.md)          | the configured site, its pre- and post-login checks, and the Moodle WS protocol: token grab, REST calls, error shapes, bot protection, pluginfile, autologin |

Dev stack: the root `npm run dev` runs this as the `AutoDL` (cyan) `concurrently` process.
