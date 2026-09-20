# Auth wiring

How Moodle Web-Services token auth is wired into the endpoints. The protocol itself (launch.php
grab, the WS API, autologin) is [MOODLE.md](MOODLE.md).

`MoodleToken` (`src/auth/moodleToken.js`) is the provider. One instance per university is cached in
`authInstances` (`http/server.js`) and never evicted, so `connect()` and `complete()` — two separate
HTTP calls — share one in-memory headed browser. It stores wherever its `tokenPath` points; the
per-university entry in `core/registry.js` hands it `statePath('auth', …)`, so one place decides the
location.

## connect / complete / status / disconnect

- `connect()` — builds its own `launch.php` URL and opens the **headed** browser (MFA by hand, once),
  then returns with the login still pending. The window closes itself the instant the
  `moodlemobile://token` redirect is captured, so the user never sits on a dead tab or Chromium's
  xdg-open prompt for the custom scheme. That self-close is a success, so the `disconnected` handler
  that reports an abandoned login ignores it once a token is held.
- `complete()` — waits (bounded) for the captured token, decodes it and persists
  `{ wstoken, privatetoken }` to `auth/biu-token.json` under the state root. Needs no live browser.
- `status()` — no browser, no API call: `{ connected: token file exists, expired: markExpired flag }`.
- `disconnect()` — deletes the token file, clears the flag, closes a headed login still in flight;
  a missing token is success. It never calls Moodle's revoke: a server-side revoke can fail _after_
  the local delete, leaving the two out of sync with no way to reconcile them.

## Expiry is only knowable at call time

There is no expiry heuristic — a token's validity shows only when the WS API is called. Moodle
answers a dead token with HTTP 200 + an `invalidtoken` body, which `/list`, the moodle-file resolve
and the videostream resolve map (`invalidToken(err)`) to `markExpired()` + `401 {status:'reconnect'}`
(`moodle_reconnect_required`).
`complete()` clears the flag. A bot-protection challenge (`blocked(err)`) is deliberately _not_ that
signal: it says nothing about the token, so it leaves the flag alone and answers `503`.

## Videostream authenticates on demand

Discovery is stateless WS calls with no browser. Only sniffing a `videostream` `.mp4` needs a
logged-in browser: `ensureAutologin` mints a one-shot no-MFA login from the `privatetoken`. Autologin
is rate-limited (~1/user/6 min), so the cookie is treated as fresh for ~20 min via the session's
`isAuthed()` / `markAuthed()`, reset on `close()`.
