# MOODLE.md — the Moodle Web-Services API and how this package speaks it

BIU runs Moodle. The service authenticates **once** to Moodle's mobile web service, receives a
long-lived **web-service token**, and thereafter drives the REST API over plain stateless HTTP — no
browser, no cookies, no re-MFA. It is the Google-Drive-refresh-token model, native to Moodle: MFA
drops from "every few hours" to about once per token lifetime (Moodle default: 12 weeks).

`src/moodle/wsClient.js` is the stateless REST client; `src/auth/moodleToken.js` is the one-time
headed grab + persistence ([AUTH.md](AUTH.md)).

## Token acquisition (the one headed step)

The mobile app gets its token from `admin/tool/mobile/launch.php`; we drive the same flow headed,
once:

```
GET {site}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<rand>&urlscheme=moodlemobile
  → require_login drives the Microsoft Entra SSO   (user completes MFA by hand)
  → 302  Location: moodlemobile://token=<base64>
```

- `service=moodle_mobile_app` is Moodle's built-in mobile service, which on BIU enables
  `core_course_get_contents` with `downloadfiles=1`.
- `passport` is a client nonce, only used app-side to verify the site id — a throwaway here.

**Capturing the token.** Chromium can't _follow_ `moodlemobile://`, so the token never lands as a page
URL; it surfaces on whichever signal fires first, and `connect()` watches all three (redundant by
design): `context.on('response')` (the 302's `location`), `context.on('requestfailed')` (the failed
navigation to the scheme) and `page.on('framenavigated')`.

**Decoding.** Base64; if the result lacks `:::`, retry after `decodeURIComponent` (something on the
path can percent-encode `+ / =`). The payload is `md5(wwwroot + passport) ::: wstoken ::: privatetoken`
(`privatetoken` may be absent). We persist `{ wstoken, privatetoken, savedAt }`; `wstoken`
authenticates every REST call, `privatetoken` only autologin.

## The REST API

Every call goes to `{site}/webservice/rest/server.php?wstoken=…&moodlewsrestformat=json&wsfunction=<fn>`,
GET with params in the query — except `tool_mobile_get_autologin_key` (below). Every call sends
`User-Agent: MoodleMobile 4.4.0 (44000)`: Moodle gates app-only functions on
`core_useragent::is_moodle_app()`, which substring-matches `MoodleMobile` in the UA.

**Error shape.** A _failed_ call — a dead token included — answers **HTTP 200** with
`{ exception, errorcode, message }`, never an HTTP error. `callWs` throws a `WsError` carrying
`errorcode`; `invalidToken(err)` keys on `errorcode ∈ { invalidtoken, accessexception }`, the
"Reconnect" signal. Any other errorcode is a real fault.

**Bot protection.** `lemida.biu.ac.il` sits behind Radware Bot Manager. When it decides a client is
automated — a burst of calls is enough — `server.php` stops speaking the WS protocol for minutes: it
serves a captcha page (**HTTP 200, `text/html`**, ~15 KB, `__uzma`…`__uzmd` cookies) or a **302** to
one, for any client and any UA. So `callWs` checks status and content-type _before_ parsing and throws
`WsBlockedError` (`blocked(err)`); parsing first would report only `SyntaxError: Unexpected token '<'`,
naming the symptom and hiding the cause. `/list` and `/resolve` map it to `503 {status:'blocked'}` —
no retry and no throttling: the wait is minutes long, and retrying is what deepens the block. It never
marks the token expired, so the UI must not steer to Reconnect on it. This is also why no change is
ever verified by a live request to the site.

### `core_webservice_get_site_info`

Identity + capability probe: `userid` (needed for autologin), `functions[]`, `downloadfiles`
(`1` = pluginfile downloads permitted; could be disabled per site), `release` (`4.5.10` on BIU).

### `core_course_get_contents(courseid)`

The whole course as an array of sections — `{ section, name, summary, modules[] }`, where `name` and
`summary` are HTML strings and each module carries `modname`, `name`, `url` (its view page) and, for
`resource`/`url` modules, `contents[]`. `courseIdFrom(courseUrl)` parses the numeric `id=` from
`…/course/view.php?id=N`.

## Module → strategy

| `modname`       | Strategy                                              | Target comes from                                                              |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `videostream`   | `videostream`                                         | `module.url`; the `.mp4` is sniffed there — it is **not** in the WS response   |
| `url`           | `youtube-playlist`, `google-drive` or `direct-url`    | `contents[0].fileurl`, the **external** target — no redirect hop needed        |
| `resource`      | `moodle-file` (PDF files only)                        | each `contents[]` entry with `type:'file'` — one module can hold several       |
| (section summary) | `zoom`                                              | `rec/share` links in `section.summary` HTML, not modules                        |

Routing is in [BROWSING.md](BROWSING.md). Recitation vs lecture is a keyword match over heading +
title (`discovery/moodleCourse.js`).

## File download via `pluginfile.php?token=`

Moodle-hosted files download statelessly with the wstoken in the query — no cookies, no headers.
`pluginfileUrl` sets it with `searchParams.set`, because `fileurl` may already carry
`?forcedownload=1` and string concatenation would produce a broken double query.

`assertPluginfileReadable` probes one byte (`Range: bytes=0-0`) before the URL is handed over, since
`server/`'s download is fire-and-forget and this is the last point a failure can be reported instead
of written to disk:

- a dead token answers HTTP 200 + the JSON exception body → `WsError`, which `invalidToken` recognizes;
- a bot-protection challenge is HTTP 200 too, and `curl --fail` would save the captcha page as the
  PDF → an HTML (or redirected) answer is `WsBlockedError`. Keying on HTML is safe because only files
  the WS declared `application/pdf` are routed here (`MoodleFileExtractor.canHandle`).

## Autologin (the only browser use besides zoom)

A `videostream` `.mp4` is short-lived and token-gated _in the page_, so it still has to be sniffed in a
logged-in browser — but instead of keeping a cookie session, the `privatetoken` mints a one-shot
login with **no MFA**:

```
POST tool_mobile_get_autologin_key   (privatetoken in a form-encoded body — as a GET param
                                      Moodle rejects it: invalidprivatetoken)
  → { key, autologinurl }
navigate to {autologinurl}?userid=<userid>&key=<key>   → sets the Moodle session cookie
navigate to module.url and sniff the .mp4
```

Autologin is **rate-limited (~1 per 6 minutes per user)** and **bound to the requesting IP**; the
cookie's freshness is cached ~20 min so back-to-back downloads don't trip the limit ([AUTH.md](AUTH.md)).

## Constraints

- **Token lifetime** — 12 weeks by default, admin-configurable, and revoked on password change. An
  `invalidToken` shows Reconnect (one MFA); expected, not an error.
- **Recordings in summaries** — unconfirmed against a course that actually posts `rec/share` links:
  the sample course's recordings section was empty and its recitation zoom link was a _meeting_.
