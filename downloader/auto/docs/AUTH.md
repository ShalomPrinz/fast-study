# Auth wiring

How Moodle Web-Services token auth is wired into the endpoints. The protocol itself (launch.php
grab, the WS API, the videostream handler call) is [MOODLE.md](MOODLE.md).

`MoodleToken` (`src/auth/moodleToken.js`) is the provider, for **one site at a time** — the configured
one ([MOODLE.md](MOODLE.md#the-configured-site)). `siteAuth()` in `core/registry.js` caches the
instance for that site, so every request and the background login share one instance, and hands it `tokenPath()` (`auth/tokenStore.js`), so one place decides
the location. `siteAuthFor(url)` is the same, for a URL that must live under the site.

## Switching site

`POST /config {moodle_site}` with a different site (`setSite`) deletes nothing: it ends the old
instance's pending login (its headed window closes, its Moodle lock is released), drops the cached
instance, and closes the challenge window, so no browser carries anything across sites. The same site is a no-op, and a blank one leaves no site configured.
There is one token slot: the record names its `site`, and `loadToken()` treats a record for any other
site as absent, so it is never sent to the wrong host and setting its site back makes it valid again
with no login. The token and the challenge window's profile are deleted only
by `disconnect()` or by a `connect()` on a site other than the stored token's, which replaces it; the
auth state's `storedSite` names that site beforehand so the frontend can confirm.

## connect / events / complete / status / disconnect

- `connect()` — deletes a stored token for another site with the challenge profile
  first, then builds its own `launch.php` URL, opens the **headed** browser (MFA by hand, once) and
  returns; the login then runs to its end **in the background**, independent of any HTTP request, so
  a reload or unmount cannot kill it mid-MFA. Idempotent while one runs. Only a failure to open the
  window throws. The run (`_drive`) waits (bounded by `CAPTURE_TIMEOUT_MS`, 10 minutes) for the
  captured token, **holds it in memory** and verifies it: a
  `core_webservice_get_site_info` call and the post-login site check
  ([MOODLE.md](MOODLE.md#checking-a-site-before-and-after-login)); success persists it with `userid`. The captured token replaces the
  stored one only when verified, or persisted `{ …, userid:null, unverified:true }` on a block, timeout
  or network failure; a refused or `invalidtoken` capture leaves an existing stored token untouched. The window closes itself the instant the
  `moodlemobile://token` redirect is captured, so the user never sits on a dead tab or Chromium's
  xdg-open prompt for the custom scheme; that self-close is a success, so the `disconnected` handler
  that reports an abandoned login ignores it once a token is held. Closing the last window does not
  end a Playwright-launched browser, so the user closing every login window before a token arrives
  closes the browser itself, which ends the login as `moodle_login_abandoned`.
- State and `GET /auth/events` — `MoodleToken.state()` is `{ phase, connected, expired, unverified,
  storedSite, error? }`: `phase` is `pending` while a login runs (capture and verification), else `unverified`,
  `connected` or `idle`; `storedSite` is the stored token's site when it holds a `wstoken` for a site
  other than the selected one (no site set included) — the token a Connect would delete, so the
  frontend can confirm first — else `null`; `error` is `{ code, params }` of the last failed attempt (`moodle_login_abandoned`,
  `moodle_login_timeout`, `moodle_site_unsupported`, `site_blocked` with `challengeWindow`,
  `moodle_reconnect_required`), cleared by the next `connect()`. The stream (`core/registry.js`'s
  `authEvents`, one emitter whichever site is set) sends `state()` as an unnamed `data:` frame on
  subscribe and again on every change (`connect`, run end, retry, lazy verification, `markExpired`,
  `disconnect`, a site switch; idle when no site is set). Every frame also carries `moodleBusy`, the
  Moodle lock's state ([GATE.md](GATE.md)), and `challenge: { open, captcha }`, block mode's window
  — up, and on screen showing a captcha until the page lands back on the site
  ([MOODLE.md](MOODLE.md#the-rest-api)), and `zoomCaptcha`, true while a zoom window is on screen for
  the user to solve a captcha ([ZOOM.md](ZOOM.md#captcha-browserzoomcaptchajs)); changes to any of them send a frame too. No replay and no heartbeat. `EventSource`
  cannot set a header, so the launch secret rides as `?secret=`, which `requireSecret` honours.
- `complete()` — re-verifies the stored `unverified` token now and answers as a WS call would; its
  outcome is also announced on the stream. Throws `moodle_login_not_pending` when no unverified token
  is stored. A fallback: a normal login never needs it, and solving the captcha runs the same
  verification by itself (`verifyAfterSolve`, a waiting request of its own, skipped while a login runs).
- Verification outcomes: `invalidtoken` or a refused site (`moodle_site_unsupported`) on the **stored** token **delete**
  it (a fresh capture is simply discarded); a bot-protection block (`site_blocked`), timeout or network failure never do. A block keeps
  the token and turns block mode on, adding `params.challengeWindow` (`'captcha'`, `'ready'` or
  `false`) as every routed call's `site_blocked` does ([MOODLE.md](MOODLE.md#the-rest-api)). A window that
  opens `'ready'` carries the verification through at once, so the login connects; on `'captcha'` or
  `false` the run ends with phase `unverified` and the `site_blocked` error, and the user solving the
  captcha verifies it. Solving the captcha does not clear Node: the clearance belongs to the window's
  browser, so the verification passes only because it goes out from that window. A successful verification leaves the window open as the transport; a new `connect()`
  or a site switch closes it (keeping its profile) and `disconnect()`, or a `connect()` replacing
  another site's token, closes it and deletes the profile.
- Lazy verification: every WS caller (`/list`, `/courses`, `/courses/check`, both `/resolve` paths) gets its token from
  `verifiedToken()` (`tokenOr` in `http/server.js`), which verifies an unverified token first
  (concurrent callers share one call) and maps its failure like any WS error.
- Token file: when the launcher sets `FASTSTUDY_TOKEN_KEY` (standard base64 of 32 bytes) it is
  AES-256-GCM, `{ v:1, iv, tag, data }` with a random 12-byte IV per write (`auth/tokenStore.js`);
  unset is plaintext (dev). A file that cannot be read (wrong key, corrupt, tampered, or encrypted
  with no key) reads as absent; a legacy plaintext one is read and rewritten encrypted. A
  malformed key throws on write.
- `status()` — no browser, no API call: `{ connected: a token for this site exists, expired: markExpired flag, unverified: the token awaits verification }`.
- `disconnect()` — deletes the token file, clears the flag and the last error, cancels a login in
  flight (window closed, no failure reported), and closes block mode's window, then deletes its
  profile (`statePath('moodle-profile')`); a missing token is success. It never calls Moodle's revoke: a server-side revoke can fail _after_
  the local delete, leaving the two out of sync with no way to reconcile them.

## Expiry is only knowable at call time

There is no expiry heuristic — a token's validity shows only when the WS API is called. Moodle
answers a dead token with HTTP 200 + an `invalidtoken` body, which `/list`, `/courses`, `/courses/check`, the moodle-file resolve
and the videostream resolve map (`invalidToken(err)`) to `markExpired()` + `401 {status:'reconnect'}`
(`moodle_reconnect_required`).
A fresh login or a successful verification clears the flag. A bot-protection challenge (`blocked(err)`) is deliberately _not_ that
signal: it says nothing about the token, so it leaves the flag alone and answers `503`.
