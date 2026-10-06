# MOODLE.md — the Moodle Web-Services API and how this package speaks it

The user's university runs Moodle — one site at a time, configured as `moodle_site` (below). The
service authenticates **once** to Moodle's mobile web service, receives a
long-lived **web-service token**, and thereafter drives the REST API over plain stateless HTTP — no
browser, no cookies, no re-MFA. It is the Google-Drive-refresh-token model, native to Moodle: MFA
drops from "every few hours" to about once per token lifetime (Moodle default: 12 weeks).

`src/moodle/wsClient.js` is the stateless REST client; `src/auth/moodleToken.js` is the one-time
headed grab + persistence ([AUTH.md](AUTH.md)).

## The configured site

`src/moodle/site.js` holds the site: an origin plus an optional path prefix (Moodle can live under
`/moodle`), no trailing slash — `{site}` below. It is seeded from `MOODLE_SITE` at boot and replaced
by `POST /config {moodle_site}`; unset, every `/auth/*`, `/list` and `/resolve` answers
`409 moodle_site_not_configured`. A course or file URL outside it (`underSite`: same origin, path at
or below the prefix) is `course_url_unsupported_site {url, site}`, which also keeps the token from
ever reaching another host. The frontend stores the `wwwroot` the probe below returned, never the
text the user typed.

## Checking a site, before and after login

The mobile flow needs three things a Moodle can switch off, so a site is checked twice.

**Before login — `POST /site/probe {url}`** (`src/moodle/probe.js`), on the settings field's blur.
From whatever was pasted, `candidateRoots` derives the origin, then each path prefix before
`/course/`, `/login/`, `/my/`, `/admin/` or `/mod/` (or the pasted path itself when it has none).
Each root in turn is asked the mobile app's own first question, which needs no account:

```
POST {root}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config
     [{"index":0,"methodname":"tool_mobile_get_public_config","args":{}}]
  → [{ "error": false, "data": { wwwroot, enablemobilewebservice, maintenanceenabled, … } }]
```

The function is `loginrequired => false` and `ajax => true` in `admin/tool/mobile/db/services.php`;
`enablemobilewebservice` and `maintenanceenabled` are `PARAM_INT` (`0`/`1`), `wwwroot` `PARAM_RAW`.
The first root that answers as Moodle decides: `supported` with `site` = its `wwwroot`, or
`unsupported` (`moodle_site_unsupported`) with `reason` `mobile_service_off` (the flag is `0`, or the
call came back as a Moodle exception envelope) or `maintenance` (retry later). `not_moodle` needs
_every_ root to have answered without Moodle JSON — a `404`/`405`/`410` page, or JSON of another
shape. A bot wall (a `200` HTML page, a `403`), a timeout or a network failure on any
root makes that unprovable, so the answer is `unverified` with `params.detail` `site_blocked`,
`timeout` or `network`: a challenge must never read as "not Moodle". A non-Moodle server that answers
every path with a `200` HTML page therefore also reads `unverified`, and the post-login check is its
backstop.

A `3xx` is followed **once**, since a university's stable address may redirect to a per-year host
(`moodle.technion.ac.il` → `moodle26.technion.ac.il`, `moodle.ariel.ac.il` →
`moodlearn.ariel.ac.il/moodlestandalone`). The same POST goes to the Location's root — the part before
`/lib/ajax/service-nologin.php` when it points there, else the Location itself — and that answer
decides as a direct one would, `site` being the target's `wwwroot`. A second redirect or a non-Moodle
target stays `unverified` `site_blocked`; a wall never answers Moodle JSON, so following is safe.
Every authenticated call still treats a redirect as the bot wall.

**After login — `MoodleToken.complete()`**, before anything is persisted, reads
`core_webservice_get_site_info` with the new token. `functions[]` lacking `core_course_get_contents`
refuses the login as `moodle_site_unsupported` `reason:'missing_function'` (`params.function`), and
`downloadfiles` other than `1` (it is `VALUE_OPTIONAL`, so absent counts) as `downloads_disabled` —
both `422 {status:'unsupported'}` from `/auth/complete`. Lacking only `tool_mobile_get_autologin_key`
still connects: discovery and PDFs work, and a `videostream` resolve fails later with its own error.

**Telemetry.** `siteReport.js` sends one Sentry warning, `moodle_site_unsupported`, tagged
`moodle_host` / `moodle_stage` (`probe`|`login`) / `moodle_reason` with the site's `release` as
extra, per `(host, reason)` per process — the probe runs on every blur. It fires on a definitive
`unsupported` and on `autologin_unavailable`, never on `unverified` and never on `maintenance`, which
says nothing about support. Without `FASTSTUDY_SENTRY_DSN` (every dev run) it is a no-op.

## Token acquisition (the one headed step)

The mobile app gets its token from `admin/tool/mobile/launch.php`; we drive the same flow headed,
once:

```
GET {site}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<rand>&urlscheme=moodlemobile
  → require_login drives the Microsoft Entra SSO   (user completes MFA by hand)
  → 302  Location: moodlemobile://token=<base64>
```

- `service=moodle_mobile_app` is Moodle's built-in mobile service; whether it carries
  `core_course_get_contents` and `downloadfiles=1` is per site, hence the post-login check above.
- `passport` is a client nonce, only used app-side to verify the site id — a throwaway here.

**Capturing the token.** Chromium can't _follow_ `moodlemobile://`, so the token never lands as a page
URL; it surfaces on whichever signal fires first, and `connect()` watches all three (redundant by
design): `context.on('response')` (the 302's `location`), `context.on('requestfailed')` (the failed
navigation to the scheme) and `page.on('framenavigated')`.

**Decoding.** Base64; if the result lacks `:::`, retry after `decodeURIComponent` (something on the
path can percent-encode `+ / =`). The payload is `md5(wwwroot + passport) ::: wstoken ::: privatetoken`
(`privatetoken` may be absent). We persist `{ site, wstoken, privatetoken, userid, savedAt }`;
`wstoken` authenticates every REST call, `privatetoken` and `userid` (from the post-login site info)
only autologin.

## The REST API

Every call goes to `{site}/webservice/rest/server.php?wstoken=…&moodlewsrestformat=json&wsfunction=<fn>`,
GET with params in the query — except `tool_mobile_get_autologin_key` (below). Every call sends
`User-Agent: MoodleMobile 4.4.0 (44000)`: Moodle gates app-only functions on
`core_useragent::is_moodle_app()`, which substring-matches `MoodleMobile` in the UA.

**Error shape.** A _failed_ call — a dead token included — answers **HTTP 200** with
`{ exception, errorcode, message }`, never an HTTP error. `callWs` throws a `WsError` carrying
`errorcode`; `invalidToken(err)` keys on `errorcode ∈ { invalidtoken, accessexception }`, the
"Reconnect" signal. Any other errorcode is a real fault.

**Bot protection.** A site may sit behind a bot manager; BIU's `lemida.biu.ac.il` is behind Radware
Bot Manager, and the rest of this paragraph is its behaviour. When it decides a client is
automated — a burst of calls is enough — `server.php` stops speaking the WS protocol for minutes: it
serves a captcha page (**HTTP 200, `text/html`**, ~15 KB, `__uzma`…`__uzmd` cookies) or a **302** to
one, for any client and any UA. So `callWs` checks status and content-type _before_ parsing and throws
`WsBlockedError` (`blocked(err)`); parsing first would report only `SyntaxError: Unexpected token '<'`,
naming the symptom and hiding the cause. `/list` and `/resolve` map it to `503 {status:'blocked'}`,
code `site_blocked` with the shape it served as `detail` —
no retry and no throttling: the wait is minutes long, and retrying is what deepens the block. It never
marks the token expired or deletes it, so the UI must not steer to Reconnect on it; at login the
token is kept and a headed window on the site root lets the user solve the challenge
([AUTH.md](AUTH.md#connect--complete--status--disconnect)). This is also why no change is
ever verified by a live request to any university's site.

### `core_webservice_get_site_info`

Identity + capability probe, read once, by the post-login check: `userid` (stored for autologin),
`functions[]` (`{ name, version }`), `downloadfiles` (`1` = pluginfile downloads permitted),
`release` (`4.5.10` on BIU).

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
