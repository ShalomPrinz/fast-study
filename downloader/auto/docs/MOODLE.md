# MOODLE.md — the Moodle Web-Services API and how this package speaks it

BIU runs Moodle. The auto-downloader authenticates **once** to Moodle's mobile web-service,
receives a long-lived **web-service token**, and thereafter drives Moodle's REST API over
plain stateless HTTP — no browser, no cookies, no re-MFA. This is the Google-Drive-refresh-token
model, native to Moodle: MFA collapses from "every few hours" to ~once per token lifetime
(Moodle default: 12 weeks). This doc is the protocol reference for that integration.

Two modules implement the client side:

- **`src/moodle/wsClient.js`** — the stateless REST client (`getSiteInfo`, `getCourseContents`,
  `getAutologinKey`, `pluginfileUrl`, `courseIdFrom`, `invalidToken`, `WsError`, `DEFAULT_SITE`).
- **`src/auth/moodleToken.js`** — the one-time headed token grab + persistence (`MoodleToken`).

## Token acquisition (the one headed step)

Moodle's mobile app obtains its token from `admin/tool/mobile/launch.php`. We drive the same
flow headed, exactly once:

```
GET {site}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<rand>&urlscheme=moodlemobile
  → require_login drives the Microsoft Entra SSO   (user completes MFA by hand, once)
  → 302  Location: moodlemobile://token=<base64>
```

- `service=moodle_mobile_app` is Moodle's built-in mobile service (460 functions enabled on BIU,
  including `core_course_get_contents`, with `downloadfiles=1`).
- `passport` is any client-generated nonce; it's only used app-side to verify the returned
  site id, so we generate a throwaway value and don't check it.
- `urlscheme=moodlemobile` makes launch.php hand the token back via a custom-scheme redirect.

**Capturing the token.** Chromium can't _follow_ the `moodlemobile://` scheme, so the token
never lands as a page URL — it surfaces on whichever low-level signal fires first. `connect()`
watches all three (redundant by design):

```
context.on('response')      → the 302's `location` response header
context.on('requestfailed') → the failed navigation to the custom scheme
page.on('framenavigated')   → the frame URL
```

each tested against the `moodlemobile://token=` prefix.

**Decoding.** The captured value is base64. Decode it, and if the result lacks `:::` retry
after `decodeURIComponent` (something along the path can percent-encode the `+ / =`). The
decoded payload is `:::`-joined:

```
md5(wwwroot + passport)  :::  wstoken  :::  privatetoken
       parts[0]                parts[1]        parts[2]   (privatetoken may be absent)
```

We persist `{ wstoken, privatetoken, savedAt }` to `.auth/biu-token.json` (gitignored).
`wstoken` authenticates every REST call; `privatetoken` is only for autologin (see below).

## The REST API

Every call goes to `webservice/rest/server.php`, authenticated by the token in the query:

```
{site}/webservice/rest/server.php?wstoken=<wstoken>&moodlewsrestformat=json&wsfunction=<fn>[&<params>]
```

Calls are GET with params in the query, except `tool_mobile_get_autologin_key` (see below). Every
call sends `User-Agent: MoodleMobile 4.4.0 (44000)`: the token is minted through the app's own
`launch.php` (`service=moodle_mobile_app`), and Moodle gates app-only functions on
`core_useragent::is_moodle_app()`, which just substring-matches `MoodleMobile` in the UA.

**Error shape (important):** Moodle answers a _failed_ call — including a dead/expired token —
with **HTTP 200** and a JSON body `{ exception, errorcode, message }`, not an HTTP error status.
`callWs` detects `.exception` and throws a `WsError` carrying `errorcode`. `invalidToken(err)`
keys on `errorcode ∈ { invalidtoken, accessexception }` — that's the "session died → Reconnect"
signal (one MFA to re-grab a token). Any other errorcode is a real fault.

### `core_webservice_get_site_info`

Identity + capability probe. Fields we rely on: `userid` (needed for autologin), `functions[]`
(must include `core_course_get_contents`), `downloadfiles` (`1` = pluginfile downloads permitted),
`release` (Moodle version, `4.5.10` on BIU).

### `core_course_get_contents(courseid)`

The whole course as JSON — sections, their `modules[]`, and each section's `summary` HTML.
`courseIdFrom(courseUrl)` parses the numeric `id=` from `…/course/view.php?id=N` to feed it.
Returns an array of **sections**:

```jsonc
[
  {
    "section": 1,
    "name": "הרצאות",
    "summary": "<p>הרצאה מספר 1 …<a href=\"https://…zoom.us/rec/share/…\">…</a></p>", // HTML
    "modules": [
      {
        "modname": "videostream", // module type
        "name": "שילוב סרטון",
        "url": "https://lemida.biu.ac.il/mod/videostream/view.php?id=…", // the view page
        "contents": [/* present for resource/url modules — see below */],
      },
    ],
  },
]
```

## Module → item mapping

| `modname`                 | Meaning                     | Strategy                                                                 | Where the target comes from                                                                                       |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `videostream`             | in-site recorded lecture    | `videostream`                                                            | `module.url` (the view.php page); the `.mp4` is sniffed there — **not** in the WS response                        |
| `url` (recording keyword) | off-site link module        | `youtube-playlist` if the target host is YouTube, else `422 unsupported` | `module.contents[].fileurl` = the **external** target (YouTube/zoom/Drive/GitHub) — no redirect-navigation needed |
| `resource`                | Moodle-hosted file (PDF, …) | skipped (video-only)                                                     | `module.contents[].fileurl` — download proven; see `PDF_RES_FUTURE.md`                                            |

Zoom recordings are **not** modules. Their `rec/share` links live in each **`section.summary`**
HTML string. The section parser runs the same regex over `summary` that the DOM parser used to
run over the live page, tracking the most-recent `הרצאה מספר N` label to title each link.
Recitation-vs-lecture classification reuses the keyword list in `discovery/moodleCourse.js`.

## File download via `pluginfile.php?token=`

Moodle-hosted files (the `fileurl` on `resource`/other file contents) download statelessly by
appending the wstoken to the query — no cookies, no headers:

```js
const u = pluginfileUrl(content.fileurl, wstoken); // sets ?token=… via the URL API
await fetch(u); // 200, application/pdf, bytes
```

`pluginfileUrl` uses `searchParams.set` (not string concat) because `fileurl` may already carry
a query (e.g. `?forcedownload=1`) — a naïve `?token=` would produce a broken double-query.
Verified against BIU: a 10.6 MB `resource` PDF → HTTP 200, `application/pdf`. (Wiring this into
the pipeline is deferred — see `PDF_RES_FUTURE.md`.)

## Autologin (the only remaining browser use besides zoom)

A `videostream` `.mp4` is short-lived and token-gated _in the page_, not exposed via the WS API —
so it still has to be sniffed in a logged-in browser. But we no longer keep a cookie session:
instead the `privatetoken` mints a one-shot login with **no MFA**.

```
tool_mobile_get_autologin_key   (privatetoken in a form-encoded POST body — Moodle
                                 rejects it as a GET param: invalidprivatetoken)
  → { key, autologinurl, warnings }
navigate a headless browser to  {autologinurl}?userid=<userid>&key=<key>
  → sets the Moodle session cookie
navigate to module.url, sniff the .mp4 as before (same capture as background.js)
```

Constraints: autologin is **rate-limited (~1 per 6 minutes per user)** and **bound to the
requesting IP**; fine for on-demand sniffing, needs graceful backoff. `userid` comes from
`core_webservice_get_site_info`.

## Constraints / gotchas

- **Token lifetime** — Moodle default 12 weeks, admin-configurable; also revoked on password
  change. On `invalidToken` the UI shows Reconnect (one MFA to re-grab). Expected, not an error.
- **`downloadfiles`** — pluginfile downloads require this capability; `1` on BIU today, but it
  could be disabled per-site later.
- **`resource` folders** — a single `mod_resource` can hold multiple files; iterate all
  `contents[]` with `type === 'file'`, not just the first.
- **Recordings in summaries, not modules** — confirm against a course that actually has posted
  `rec/share` links; the sample course's recordings section was empty and its recitation zoom
  was a _meeting_ (not recording) link.
