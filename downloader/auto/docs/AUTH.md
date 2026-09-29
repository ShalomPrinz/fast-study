# Auth wiring

How Moodle Web-Services token auth is wired into the endpoints. The protocol itself (launch.php
grab, the WS API, autologin) is [MOODLE.md](MOODLE.md).

`MoodleToken` (`src/auth/moodleToken.js`) is the provider, for **one site at a time** — the configured
one ([MOODLE.md](MOODLE.md#the-configured-site)). `siteAuth()` in `core/registry.js` caches the
instance for that site, so `connect()` and `complete()` — two separate HTTP calls — share one
in-memory headed browser, and hands it `statePath('auth', 'moodle-token.json')`, so one place decides
the location. `siteAuthFor(url)` is the same, for a URL that must live under the site.

## Switching site

`POST /config {moodle_site}` with a different site (`setSite`) resets auth fully: it disconnects the
old instance (the token file goes, a pending headed login closes), drops the cached instance, and
closes the plain browser session under its lock, so an autologin cookie cannot carry across sites.
The same site is a no-op, and a blank one leaves no site configured. The token record names its
`site`, and `loadToken()` treats a record for any other site as absent, so a leftover can never be
sent to the wrong host.

## connect / complete / status / disconnect

- `connect()` — builds its own `launch.php` URL and opens the **headed** browser (MFA by hand, once),
  then returns with the login still pending. The window closes itself the instant the
  `moodlemobile://token` redirect is captured, so the user never sits on a dead tab or Chromium's
  xdg-open prompt for the custom scheme. That self-close is a success, so the `disconnected` handler
  that reports an abandoned login ignores it once a token is held. Closing the last window does not
  end a Playwright-launched browser, so the user closing every login window before a token arrives
  closes the browser itself, which drops the pending login.
- `complete()` — waits (bounded) for the captured token, decodes it, runs the post-login site check
  ([MOODLE.md](MOODLE.md#checking-a-site-before-and-after-login)) and only then persists
  `{ site, wstoken, privatetoken, userid, savedAt }` to `auth/moodle-token.json` under the state
  root; a refused site persists nothing. Needs no live browser.
  Fails at once with `moodle_login_abandoned` if the window is closed while it waits, and with
  `moodle_login_not_pending` if nothing is pending.
- `status()` — no browser, no API call: `{ connected: a token for this site exists, expired: markExpired flag }`.
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
logged-in browser: `ensureAutologin` mints a one-shot no-MFA login from the `privatetoken` and the
stored `userid`. Autologin
is rate-limited (~1/user/6 min), so the cookie is treated as fresh for ~20 min via the session's
`isAuthed()` / `markAuthed()`, reset on `close()`.
