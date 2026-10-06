# Auth wiring

How Moodle Web-Services token auth is wired into the endpoints. The protocol itself (launch.php
grab, the WS API, autologin) is [MOODLE.md](MOODLE.md).

`MoodleToken` (`src/auth/moodleToken.js`) is the provider, for **one site at a time** — the configured
one ([MOODLE.md](MOODLE.md#the-configured-site)). `siteAuth()` in `core/registry.js` caches the
instance for that site, so every request and the background login share one instance, and hands it `statePath('auth', 'moodle-token.json')`, so one place decides
the location. `siteAuthFor(url)` is the same, for a URL that must live under the site.

## Switching site

`POST /config {moodle_site}` with a different site (`setSite`) resets auth fully: it disconnects the
old instance (the token file goes, a pending headed login closes), drops the cached instance, and
closes the plain browser session under its lock, so an autologin cookie cannot carry across sites.
The same site is a no-op, and a blank one leaves no site configured. The token record names its
`site`, and `loadToken()` treats a record for any other site as absent, so a leftover can never be
sent to the wrong host.

## connect / events / complete / status / disconnect

- `connect()` — builds its own `launch.php` URL, opens the **headed** browser (MFA by hand, once) and
  returns; the login then runs to its end **in the background**, independent of any HTTP request, so
  a reload or unmount cannot kill it mid-MFA. Idempotent while one runs. Only a failure to open the
  window throws. The run (`_drive`) waits (bounded by `CAPTURE_TIMEOUT_MS`, 10 minutes) for the
  captured token, **holds it in memory** and verifies it: a
  `core_webservice_get_site_info` call and the post-login site check
  ([MOODLE.md](MOODLE.md#checking-a-site-before-and-after-login)); success persists it with `userid` and closes any challenge window. The captured token replaces the
  stored one only when verified, or persisted `{ …, userid:null, unverified:true }` on a block, timeout
  or network failure; a refused or `invalidtoken` capture leaves an existing stored token untouched. The window closes itself the instant the
  `moodlemobile://token` redirect is captured, so the user never sits on a dead tab or Chromium's
  xdg-open prompt for the custom scheme; that self-close is a success, so the `disconnected` handler
  that reports an abandoned login ignores it once a token is held. Closing the last window does not
  end a Playwright-launched browser, so the user closing every login window before a token arrives
  closes the browser itself, which ends the login as `moodle_login_abandoned`.
- State and `GET /auth/events` — `MoodleToken.state()` is `{ phase, connected, expired, unverified,
  error? }`: `phase` is `pending` while a login runs (capture and verification), else `unverified`,
  `connected` or `idle`; `error` is `{ code, params }` of the last failed attempt (`moodle_login_abandoned`,
  `moodle_login_timeout`, `moodle_site_unsupported`, `site_blocked` with `challengeWindow`,
  `moodle_reconnect_required`), cleared by the next `connect()`. The stream (`core/registry.js`'s
  `authEvents`, one emitter whichever site is set) sends `state()` as an unnamed `data:` frame on
  subscribe and again on every change (`connect`, run end, retry, lazy verification, `markExpired`,
  `disconnect`, a site switch; idle when no site is set). No replay and no heartbeat. `EventSource`
  cannot set a header, so the launch secret rides as `?secret=`, which `requireSecret` honours.
- `complete()` — re-verifies the stored `unverified` token now (a block on the last try, the
  challenge since solved) and answers as a WS call would; its outcome is also announced on the stream.
  Throws `moodle_login_not_pending` when no unverified token is stored. A normal login never needs it.
- Verification outcomes: `invalidtoken` or a refused site (`moodle_site_unsupported`) on the **stored** token **delete**
  it (a fresh capture is simply discarded); a bot-protection block (`site_blocked`), timeout or network failure never do. A block keeps
  the token, opens one headed browser (`launchBrowser`) on the site root so the user can solve the
  bot manager's challenge (reused while open) and adds `params.challengeWindow:true` to the 503
  (`false` if no browser could launch). The window closes on successful verification,
  `disconnect()` or a new `connect()`. A block ends the login's run with phase `unverified` and the `site_blocked` error. Once a human solves it, Node requests from that IP pass again.
- Lazy verification: every WS caller (`/list`, both `/resolve` paths) gets its token from
  `verifiedToken()` (`tokenOr` in `http/server.js`), which verifies an unverified token first
  (concurrent callers share one call) and maps its failure like any WS error.
- Token file: when the launcher sets `FASTSTUDY_TOKEN_KEY` (standard base64 of 32 bytes) it is
  AES-256-GCM, `{ v:1, iv, tag, data }` with a random 12-byte IV per write (`auth/tokenStore.js`);
  unset is plaintext (dev). A file that cannot be read (wrong key, corrupt, tampered, or encrypted
  with no key) reads as absent; a legacy plaintext one is read and rewritten encrypted. A
  malformed key throws on write.
- `status()` — no browser, no API call: `{ connected: a token for this site exists, expired: markExpired flag, unverified: the token awaits verification }`.
- `disconnect()` — deletes the token file, clears the flag and the last error, and cancels a login in
  flight (window closed, no failure reported); a missing token is success. It never calls Moodle's revoke: a server-side revoke can fail _after_
  the local delete, leaving the two out of sync with no way to reconcile them.

## Expiry is only knowable at call time

There is no expiry heuristic — a token's validity shows only when the WS API is called. Moodle
answers a dead token with HTTP 200 + an `invalidtoken` body, which `/list`, the moodle-file resolve
and the videostream resolve map (`invalidToken(err)`) to `markExpired()` + `401 {status:'reconnect'}`
(`moodle_reconnect_required`).
A fresh login or a successful verification clears the flag. A bot-protection challenge (`blocked(err)`) is deliberately _not_ that
signal: it says nothing about the token, so it leaves the flag alone and answers `503`.

## Videostream authenticates on demand

Discovery is stateless WS calls with no browser. Only sniffing a `videostream` `.mp4` needs a
logged-in browser: `ensureAutologin` mints a one-shot no-MFA login from the `privatetoken` and the
stored `userid`. Autologin
is rate-limited (~1/user/6 min), so the cookie is treated as fresh for ~20 min via the session's
`isAuthed()` / `markAuthed()`, reset on `close()`.
