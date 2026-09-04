# Auth wiring

How the service wires Moodle Web-Services token auth into its endpoints. The token
protocol itself (launch.php grab, the WS API, autologin) lives in `docs/MOODLE.md`.

`MoodleToken` (`src/auth/moodleToken.js`) is the auth provider. One instance is cached **per
university** in `authInstances` (`http/server.js`) and never evicted, so `connect()` and
`complete()` — two separate HTTP calls — share the same in-memory headed browser. `MoodleToken`
stores wherever its `tokenPath` points and resolves nothing: the per-university entry in
`core/registry.js` hands it an absolute `statePath('auth', …)`, so one place decides the location
for every university.

## connect / complete / status

- `connect()` — takes no args; builds its own `launch.php` URL and opens the **headed**
  browser (MFA by hand, once). Returns immediately, login still pending. The headed window
  closes itself the instant the `moodlemobile://token` redirect is captured, so the user
  never sees the dead tab or Chromium's xdg-open prompt for the custom scheme.
- `complete()` — waits for the (already-captured) token string, decodes it, and persists
  `{ wstoken, privatetoken }` to `auth/biu-token.json` under the state root; it needs no live browser (its own
  close is a no-op after the self-close). `/auth/complete` returns `{ connected: true }`.
- `status()` — no browser, no API call: `{ connected: token file exists, expired: markExpired flag }`.

## Expiry is only knowable at call time

There is no cookie/expiry heuristic — a token's validity is only observable by hitting the WS
API. So `expired` is purely the runtime `markExpired()` flag. Moodle answers a dead token with
HTTP 200 + an `invalidtoken` exception body (see `docs/MOODLE.md`); `/list` and the videostream
download map that (`invalidToken(err)`) to `markExpired()` + `401 {status:'reconnect'}`, steering
the UI to reconnect. `complete()` clears the flag.

## Videostream download authenticates on demand

Discovery is stateless WS calls (no browser). Only sniffing a `videostream` `.mp4` needs a
logged-in browser, and it authenticates on demand: `ensureAutologin` mints a one-shot no-MFA
Moodle login from the `privatetoken` (autologin protocol in `docs/MOODLE.md`). Autologin is
rate-limited (~1/user/6 min), so the cookie's freshness is cached ~20 min via the session's
`isAuthed()` / `markAuthed()` (reset on `close()`).
