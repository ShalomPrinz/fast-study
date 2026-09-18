# CLAUDE.md — auto (auto-downloader)

A Playwright HTTP service that, given a **course URL**, authenticates to Moodle's Web-Services API (one headed token grab, then a long-lived stateless token), discovers the course's recordings and PDF handouts, and resolves any of them into download targets (`POST /resolve`) that `server/` fetches and turns into jobs. A **separate package** with its own `node_modules` so Playwright and its browsers never leak into `server/`'s lighter dependency set. User-facing setup: [README.md](README.md).

## Run

```bash
npm --prefix downloader/auto start   # HTTP service, app.js
npx playwright install chromium      # once, as the plain profile's fallback browser
npm --prefix downloader/auto test    # node --test, pure logic only (no browser, no network)
```

Port **3053** (`AUTODL_PORT` in the repo-root `.env`; `FASTSTUDY_PORT` in the environment wins), bound to `127.0.0.1`. CORS allows `http://localhost:5173` and `app://bundle`. An installed Chrome or Edge is required for every browser profile, and zoom capture also needs `Xvfb` on Linux ([SESSIONS.md](docs/SESSIONS.md)).

Launch contract — the `FASTSTUDY_SECRET` check (`requireSecret`, every route but `GET /health`) and the state root (`statePath`, under which the Moodle token, the zoom passcode store and the yt-dlp cache live) — comes from [`@faststudy/runtime`](../../lib/runtime/CLAUDE.md). `yt-dlp` resolves through [`@faststudy/tools`](../../lib/tools/CLAUDE.md) and is reported on `/health` as `tools`. It only runs `--flat-playlist`, which never touches YouTube's player script, so it carries none of `server/`'s JS-runtime flags.

## HTTP surface

Mechanism-agnostic: `/list` and `/list/expand` return uniform `Item`s whose download mechanism hides inside an opaque `ref` (base64url `Recording`); `/resolve` takes `{ ref, … }`. The `Item` fields and their meaning are in [BROWSING.md](docs/BROWSING.md).

| Endpoint                | Body                                                | Returns                                                                     |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /health`           | —                                                   | `{ status:'ok', tools }` — what the launcher waits on                       |
| `GET /prereqs/browser`  | —                                                   | `{ available, channel, browser, detail }` — always 200                      |
| `GET /auth/status`      | —                                                   | `{ connected, expired }`                                                    |
| `POST /auth/connect`    | `{}`                                                | `{ status:'pending' }` (headed token grab opens)                            |
| `POST /auth/complete`   | —                                                   | `{ connected:true }` (persists the Moodle WS token)                         |
| `POST /auth/disconnect` | —                                                   | `{ connected:false }` (deletes the local token; no server-side revoke)      |
| `POST /list`            | `{ courseUrl }`                                     | `{ items }`                                                                 |
| `POST /list/expand`     | `{ ref }`                                           | `{ items }` (one expandable item → children)                                |
| `POST /resolve`         | `{ ref, course, name, kind, only?, forceCapture? }` | `{ media, targets }`                                                        |
| `POST /zoom/passcode`   | `{ course, name?, passcode, scope }`                | `{}` (`scope:'course'\|'lecture'`)                                          |
| `POST /close`           | —                                                   | `{}` (close every persistent browser)                                       |

`/resolve` returns targets, never a download: `targets` is `[{ name, tool, url, headers?, fromCache }]`, one per file that will land (a zoom before/after-break pair yields `<base>.1`/`<base>.2`). `tool` (`'curl'`|`'fetch'`|`'ytdlp'`) is the key of the `server/` downloader that can fetch it; `headers` rides only with `curl`. `media` (`'video'`|`'material'`) is what actually lands — a probed row only learns it here. auto keeps no job state; `server/` creates a job per target and owns it from there ([server JOBS.md](../server/docs/JOBS.md)).

**Session replay cache** (`src/core/replayCache.js`). Every resolved cap is kept in memory keyed by its final `(course, lecture, kind, media)` target, so a retry replays it without re-capturing — never logged (caps hold cookies/tokens), unbounded (session-small). `only:true` acts on just the one named target (a zoom split name included); `forceCapture:true` bypasses the cache (and every probe cache). `fromCache` on each target tells `server/` whether an auth failure is worth one silent re-resolve. `only`+`forceCapture` re-sniffs the whole share (one zoom share yields both clips) and returns just the matching cap.

Error statuses, each a distinct signal the frontend branches on:

- `401 {status:'reconnect'}` — the Moodle WS token is missing or answered `invalidtoken` ([AUTH.md](docs/AUTH.md)).
- `409 {status:'passcode', reason, course, name}` — zoom passcode `missing` or `incorrect`; save one via `/zoom/passcode` and retry ([ZOOM.md](docs/ZOOM.md)).
- `422 {status:'unsupported', message}` — the source can never be handled here (a link that probes as a non-video, non-PDF file, a web page, a dead link, an unshared Drive file). Memoized per probe key, so `/list` stamps `resolvedMedia:'unsupported'` ([BROWSING.md](docs/BROWSING.md)).
- `503 {status:'blocked', message}` — the Moodle site served a bot-protection challenge; transient, unrelated to the token, never retried here ([MOODLE.md](docs/MOODLE.md)).

## Docs

| Doc                                  | Concern                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| [SESSIONS.md](docs/SESSIONS.md)      | persistent per-profile browsers, `withLock`, idle timeout, the launch matrix, the channel resolver |
| [ZOOM.md](docs/ZOOM.md)              | why zoom needs a headed, stealthed, hidden Chrome/Edge; passcode gate; before/after-break split |
| [BROWSING.md](docs/BROWSING.md)      | listing (parsers, routing, `Item`/`ref` contract), expansion, and the per-strategy resolve + probes |
| [AUTH.md](docs/AUTH.md)              | how the token provider is wired into the endpoints; expiry; on-demand autologin               |
| [MOODLE.md](docs/MOODLE.md)          | the Moodle WS protocol: token grab, REST calls, error shapes, bot protection, pluginfile, autologin |

Dev stack: the root `npm run dev` runs this as the `AutoDL` (cyan) `concurrently` process.
