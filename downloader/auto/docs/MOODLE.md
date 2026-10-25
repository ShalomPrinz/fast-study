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
`timeout` or `network`: a challenge must never read as "not Moodle". A `site_blocked` answer turns
block mode on for that root and carries `params.challengeWindow` as a 503 does ([below](#the-rest-api)). A non-Moodle server that answers
every path with a `200` HTML page therefore also reads `unverified`, and the post-login check is its
backstop.

A `3xx` is followed **once**, since a university's stable address may redirect to a per-year host
(`moodle.technion.ac.il` → `moodle26.technion.ac.il`, `moodle.ariel.ac.il` →
`moodlearn.ariel.ac.il/moodlestandalone`). The same POST goes to the Location's root — the part before
`/lib/ajax/service-nologin.php` when it points there, else the Location itself — and that answer
decides as a direct one would, `site` being the target's `wwwroot`. A second redirect or a non-Moodle
target stays `unverified` `site_blocked`; a wall never answers Moodle JSON, so following is safe.
Every authenticated call still treats a redirect as the bot wall.

**After login — the verification step of `MoodleToken`'s login**, with the captured token still held in memory, reads
`core_webservice_get_site_info` with the new token. `functions[]` lacking `core_course_get_contents`
refuses the login as `moodle_site_unsupported` `reason:'missing_function'` (`params.function`), and
`downloadfiles` other than `1` (it is `VALUE_OPTIONAL`, so absent counts) as `downloads_disabled` —
both `422 {status:'unsupported'}` from `/auth/complete` (and as the login's `moodle_site_unsupported` error on the stream). Lacking only `tool_mobile_get_content`
still connects: discovery and files work, and a `videostream` resolve is refused later as
`422 {status:'unsupported'}`, `moodle_site_unsupported` `reason:'videostream_unavailable'` ([Videostream](#videostream)).
Lacking `core_enrol_get_users_courses` also connects, saving `coursesAvailable:false` in the token
record ([The course picker](#the-course-picker)); it is reported as `reason:'courses_unavailable'`.

**Telemetry.** `siteReport.js` sends one Sentry warning, `moodle_site_unsupported`, tagged
`moodle_host` / `moodle_stage` (`probe`|`login`) / `moodle_reason` with the site's `release` as
extra, per `(host, reason)` per process — the probe runs on every blur. It fires on a definitive
`unsupported` and on `videostream_unavailable` and `courses_unavailable`, never on `unverified` and never on `maintenance`, which
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

**Decoding.** Base64 of the `decodeURIComponent`d string first, then of the raw one, the first with
`:::` winning (something on the path can percent-encode `+ / =`): Node's lenient base64 decodes a raw
`%3D` form too, leaving a stray character on `privatetoken`. The payload is `md5(wwwroot + passport) ::: wstoken ::: privatetoken`
(`privatetoken` may be absent). We persist `{ site, wstoken, privatetoken, userid, coursesAvailable, savedAt }`;
`wstoken` authenticates every REST call, `userid` (from the post-login site info) rides in the
videostream handler call and the course list, and `coursesAvailable` is the post-login check's verdict; nothing reads `privatetoken`, kept so the token file's format stays put.

## The REST API

Every call goes to `{site}/webservice/rest/server.php?wstoken=…&moodlewsrestformat=json&wsfunction=<fn>`,
GET with params in the query — except `tool_mobile_get_content` (below), a form-encoded POST. Every call from Node
sends `User-Agent: MoodleMobile 4.4.0 (44000)`: Moodle gates app-only functions on
`core_useragent::is_moodle_app()`, a case-insensitive substring match for `moodlemobile` in the UA
(`lib/classes/useragent.php`). In block mode
(below) calls carry the window's launch UA instead — the browser's real UA plus ` MoodleMobile` — so
app-only functions, `tool_mobile_get_content` included, pass through it too.

**Error shape.** A _failed_ call — a dead token included — answers **HTTP 200** with
`{ exception, errorcode, message }`, never an HTTP error. `callWs` throws a `WsError` carrying
`errorcode`; `invalidToken(err)` keys on `errorcode ∈ { invalidtoken, accessexception }`, the
"Reconnect" signal. Any other errorcode is a real fault. Each `WsError` logs one line with the
function, `errorcode`, the route (`node`/`window`) and `debuginfo` when Moodle sent one (the request's
tokens blanked: it can echo a rejected param), and its message ends `(<errorcode>)` because Sentry
sees the message, never `params`, and Moodle's own text is localized.

**Bot protection.** A site may sit behind a bot manager; BIU's `lemida.biu.ac.il` is behind Radware
Bot Manager, and the rest of this paragraph is its behaviour ([evidence below](#bot-protection-what-was-learned)).
When it decides a client is automated — a burst of calls is enough — `server.php` stops speaking the
WS protocol for well over 15 minutes: it serves a captcha page (**HTTP 200, `text/html`**) or a **302**
to one, to every non-browser client whatever UA or cookies it sends. So `callWs` checks status and
content-type _before_ parsing and throws `WsBlockedError` (`blocked(err)`); parsing first would report
only `SyntaxError: Unexpected token '<'`. Every route maps it to `503 {status:'blocked'}`, code
`site_blocked` with the shape it served as `detail` — no retry, no throttling, never marking the token
expired. This is also why no change is ever verified by a live request to any university's site.

**Block mode** (`src/moodle/challenge.js`). The clearance a human earns by solving the captcha belongs
to the browser that solved it and cannot be copied to Node, so during a block the only calls that pass
are made from inside that browser:

- **On.** A wall on a routed call (below) made from Node — or a `site_blocked` probe — opens one
  headed persistent Chrome on `statePath('moodle-profile')` — the
  `launchBrowser` channel chain, always launched with `--window-position=-32000,-32000` and
  `userAgent` set to the channel's real UA plus ` MoodleMobile` — and loads the site root. The UA is
  fixed for the browser's life: Radware ties the clearance to it and walls a switch after the solve.
  It comes from the channel probe (`HeadlessChrome` → `Chrome`, [SESSIONS.md](SESSIONS.md#which-browser-browserbrowserchanneljs));
  with none known (no installed Chrome or Edge, or a probe whose page read failed — re-probed on the
  next open, never cached) no window opens (`false`), rather than one cleared
  under a UA Moodle's app-only calls refuse. A profile cleared under an earlier, plain UA meets one
  captcha on its first launch with this one. Landing on the site means the profile's
  clearance still holds: it stays off-screen and `moodleFetch` resends the same call through it once
  (the wall means Moodle never processed it; bodies are strings or forms, so they send twice), so
  the caller never sees the block. Landing anywhere else is the captcha: the window moves on screen
  (CDP `Browser.setWindowBounds`), comes to the front and holds the Moodle lock
  ([GATE.md](GATE.md#holds-that-outlive-the-request)) (`POST /window/show` raises it again, as for zoom's
  [captcha](ZOOM.md#captcha-browserzoomcaptchajs)), and the call waits for the user's solve
  (`waitChallenge`): the page landing back on the site resends it through the window once and it
  returns normally, so the caller never sees the captcha either. A human is solving it, so this is
  no retry loop: one resend, no backoff. Unsolved 10 minutes after it went on screen (`captchaMs`, one
  deadline per captcha that no later call or waiter restarts, so a call joining at minute 9 waits
  about one; it also closes the window) the call throws `503 site_captcha_timeout {}` with no `status`;
  the user closing the window mid-wait throws an unrouted `site_blocked` (below). The wait follows
  the request's abort signal (the gate ticket's, or `/moodle/file`'s own), so a caller that hangs up
  stops waiting alone. `false`: no browser could launch, and the call throws `site_blocked` with
  `params.challengeWindow:false`. `getPublicConfig` opts out
  (`reopen:false`) — its 3xx or HTML may be a real redirect or a non-Moodle server — so it never
  waits and the probe opens the window itself and reports `challengeWindow`, `'captcha'` and
  `'ready'` included (none when the window closed while it loaded), holding the lock for a press as before any wait. A block while it is up reuses it (Chrome locks the profile, so a second launch would
  fail), reloading its root when the page itself was challenged.
- **The route.** While it is open, `moodleFetch` sends every call on its site — WS calls, the public
  config, the pluginfile preflight and stream — as a `fetch` from the page. The site's own scripts
  (from `cdn.jsdelivr.net`, `js.nagich.co.il`) replace the page's `fetch` and
  `XMLHttpRequest.prototype.send`, so it is the native `fetch` of a hidden same-origin `about:blank`
  iframe the call adds once per document (again after a navigation) (`redirect:'manual'`,
  `credentials:'include'`, `cache:'no-store'`, no `User-Agent`, `Range` passed through, form bodies
  serialized) and rebuilds a Node `Response`, so the wall checks run unchanged: the page's unreadable
  `opaqueredirect` reads as a 302, and the body crosses back in 4 MB base64 slices. A call while
  the page is still on the captcha sends nothing and waits on the same solve (`getPublicConfig`
  alone is refused `site_blocked` unsent). The page landing back on the site (the
  solve), or the first call through it that is not wall-shaped, moves the window back off-screen
  and lets the lock go; the solve also emits `challengeEvents` `'solved'`, on which the registry
  verifies a stored `unverified` token through the window ([AUTH.md](AUTH.md#connect--events--complete--status--disconnect)).
  A call through the page that still meets the wall reloads the root: landing on a captcha it
  waits and resends once more — at most one wait beyond the first per call, so a site that walls
  the solved browser cannot spin — and otherwise throws `site_blocked`, whose 503 says
  `'captcha'` or `'ready'` (repeat the action). A window closed mid-call, mid-wait or while it loads fails that call as an unrouted `site_blocked`
  (no window reopens; the user's repeat goes out on Node). A page fetch that fails in the network (the page sees only
  `TypeError: Failed to fetch`) answers `site_unreachable` like a Node one: `host` the URL's hostname,
  `detail` only Chrome's `ERR_*` token from that request's `requestfailed` (matched on URL and method), else
  `null` — never the URL, which carries the wstoken. Not routed, so still
  `site_blocked` during a block: `openMoodleFile` (it replays a file's recorded headers, which a page cannot
  set) and `lib/probeUrl.js`. A block there opens no window and its 503 carries no `challengeWindow`
  (`WsBlockedError.routed` is false; `reportBlock` skips it).
- **Off.** Block mode ends when the browser closes: the user closing it, `disconnect()` (which then
  deletes the profile), a new `connect()`, a site switch, or 60 s with no call through it — 10 minutes while a
  body is open, unfinished and uncancelled (a paused `/moodle/file` reader; every answer `wsClient.js` throws
  on without reading is cancelled first, so only a reader's pause stretches it). A captcha on screen instead
  closes it at its fixed deadline (`captchaMs`, above), which no call restarts. A page call still running defers it. The
  profile is kept, so the next walled call reopens it hidden — usually with no new captcha — and
  passes through it.
- `/auth/events` carries `challenge: { open, captcha, solved }` ([AUTH.md](AUTH.md#connect--events--complete--status--disconnect)).

### `core_webservice_get_site_info`

Identity + capability probe, read once, by the post-login check: `userid` (stored for the videostream call),
`functions[]` (`{ name, version }`), `downloadfiles` (`1` = pluginfile downloads permitted),
`release` (`4.5.10` on BIU).

### `core_course_get_contents(courseid)`

The whole course as an array of sections — `{ section, name, summary, modules[] }`, where `name` and
`summary` are HTML strings and each module carries `modname`, `name`, `url` (its view page) and, for
`resource`/`url` modules, `contents[]`. `courseIdFrom(courseUrl)` parses the numeric `id=` from
`…/course/view.php?id=N`, leniently (any path). A Moodle exception here other than a dead token
(not enrolled, no such course) is `422 course_not_accessible {url, detail}` on `/list` and
`/courses/check`, `detail` Moodle's own message.

### `core_enrol_get_users_courses(userid)`

The account's enrolled courses — `{ id, shortname, fullname, displayname, visible, hidden?, enddate, … }`.
`moodlewssettingfilter=true&moodlewssettinglang=<he|en>` runs the multilang filter, so `fullname`
comes back in that one language (BIU stores both glued, `אלגוריתמים 1Algorithms 1`); sites without
the filter ignore both flags. `displayname` is `shortname + " " + fullname` at BIU; `idnumber` is not the code.

## The course picker

`GET /courses?lang=he|en` lists the enrolled courses as `{ available:true, courses:[{ id, name, code, url, past }] }`.
`lang` (the UI locale) adds the multilang flags above; any other value or none sends no flags. `name`
is `fullname` through `stripTags` (trimmed), `code` is `shortname` trimmed or `null`, `url` is `{site}/course/view.php?id=N`,
and `past` is `hidden`, `visible:0` or an `enddate` already gone by; sorted by name. It is **one WS
call per picker open**: BIU's Radware walled a second call made 2 s after the first. So availability
is never discovered by calling the function — a function missing from the token's service answers
`accessexception`, which `invalidToken()` reads as a dead token — but saved at login as
`coursesAvailable`. Anything but `true` (a record saved before the flag existed included) answers
`{ available:false }` with no call; a reconnect refreshes it. An unverified token is verified first
in the same gated request, as on `/list`.

`POST /courses/check {courseUrl}` vets a pasted URL before it is saved. Strictly an http(s)
`{site}/course/view.php` with an all-digit `id`, else `400 course_url_not_course_page {url}` (off the
site: `course_url_unsupported_site`); then one `core_course_get_contents` → `{ ok:true }`, or `401`
reconnect, `503` blocked, `422 course_not_accessible`. `/list` keeps its lenient parsing, so a URL the
user saved anyway still lists.

## Module → strategy

| `modname`       | Strategy                                              | Target comes from                                                              |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `videostream`   | `videostream`                                         | `module.url`'s `id` (the cmid) + the course id → the plugin's app handler      |
| `url`           | `youtube-playlist`, `google-drive` or `direct-url`    | `contents[0].fileurl`, the **external** target — no redirect hop needed        |
| `resource`      | `moodle-file` (any file but video, audio, HTML)      | each `contents[]` entry with `type:'file'` — one module can hold several       |
| (section summary) | `zoom`                                              | `rec/share` links in `section.summary` HTML, not modules                        |

Routing is in [BROWSING.md](BROWSING.md). Recitation vs lecture is a keyword match over heading +
title (`discovery/moodleCourse.js`).

## File download via `pluginfile.php?token=`

Moodle-hosted files download statelessly with the wstoken in the query — no cookies, no headers.
`pluginfileUrl` sets it with `searchParams.set`, because `fileurl` may already carry
`?forcedownload=1` and string concatenation would produce a broken double query.

The tokened URL never leaves auto: `server/` fetches the file from auto's `/moodle/file/:id`, which
streams it under the Moodle lock ([GATE.md](GATE.md#files)). `assertPluginfileReadable` probes one
byte (`Range: bytes=0-0`) at `/resolve`, since `server/`'s download is fire-and-forget and this is
the last point a failure can be reported instead of written to disk; its `Content-Range` total is
the size `HEAD` answers. `openPluginfile` applies the same checks when the stream starts:

- a dead token answers HTTP 200 + the JSON exception body → `WsError`, which `invalidToken` recognizes;
- a bot-protection challenge is HTTP 200 too, and `curl --fail` would save the captcha page as the
  file → an HTML (or redirected) answer is `WsBlockedError`. Keying on HTML is safe because a resource
  declared `text/html` is never routed here (`MoodleFileExtractor.canHandle`), so an HTML reply is a block page.

## Videostream

No WS function names a `videostream` `.mp4`, but BIU's `mod_videostream` (a private build; the public
openapp1 repo has no mobile support) ships a Moodle-app handler, `view_videostream`. Called through
`tool_mobile_get_content` with the stored token it returns the page the app renders, and that page
names the `.mp4` — no browser, no session, no login. `getVideostreamContent` (`wsClient.js`) sends
exactly what the Moodle app sends (`moodleapp` `siteplugins.ts` `getContent` + `addDefaultArgs`):

```
POST {site}/webservice/rest/server.php?wstoken=…&moodlewsrestformat=json&wsfunction=tool_mobile_get_content
  moodlewssettingfilter=true  moodlewssettingfileurl=true  moodlewssettinglang=he
  component=mod_videostream   method=view_videostream
  args[i][name]/args[i][value] for: courseid, cmid, userid, appid=com.moodle.moodlemobile,
    appversioncode=45000, appversionname=4.5.0, applang=he, appcustomurlscheme=moodlemobile,
    appisdesktop=0, appismobile=1, appiswide=0, appplatform=android
  → { templates: [{ id:'main', html }], javascript, otherdata, files, restrict, disabled }
```

Send every one of them. A GET without `userid` and the `moodlewssetting*` flags (or `cmid` alone)
crashes the handler (`rawurlencode(): Argument #1 ($string) must be of type string, array given`);
`id`=cmid is `invalidrecordunknown`, `id`=the instance crashes or answers `502`. Never send `id`.
`cmid` is `module.url`'s `id`; `courseid` rides on the listed row (`courseId`), and a row listed
before it did is resolved with one `core_course_get_course_module(cmid)` call → `cm.course` first.

`resolveVideostream` (`core/core.js`) takes the first `<source … type="video/mp4">` of the templates'
HTML (`&amp;` decoded, an https URL whose path ends `.mp4`). The plugin also has HLS, Vimeo and
symlink templates; a player with no MP4 source is `videostream_no_mp4 {url}`, the types it did find
named in the prose only. A replay-cache hit answers with no call (`forceCapture` bypasses it).

On BIU the `.mp4` lives on Oracle object storage
(`*.compat.objectstorage.il-jerusalem-1.oraclecloud.com/video_bucket/<2 hex>/<sha1>.mp4`): no query
token, no cookies, `206 video/mp4` to a bare curl, permanent. So it is a plain `curl` target with no
headers, never proxied, and `server/` probes its size itself; a site that hosts the `.mp4` on Moodle
gets it streamed through auto ([GATE.md](GATE.md#files)). The call goes through `moodleFetch` like
every WS call — gated, and through the challenge window in block mode — so a wall is `503
site_blocked` and `invalidtoken` is `401 reconnect`. Moodle answers `accessexception` both for an
expired token and for a function outside the token's service (`webservice/lib.php`), so on that code
one site-info call decides: a live token whose `functions[]` lacks `tool_mobile_get_content` is `422
{status:'unsupported'}`, `moodle_site_unsupported {site, reason:'videostream_unavailable'}`; anything
else stays `401 reconnect`.

Only a `videostream` row reaches the handler: `/resolve` refuses any row its earlier branches did not
take and that is not `zoom` (an unexpanded playlist, a strategy this build does not know) as
`422 {status:'unsupported'}`, `recording_strategy_unsupported {strategy}`, before any Moodle call.

## Bot protection: what was learned

Two diagnostic runs on Windows (2026-10-09) against BIU, with the block active throughout. The scripts
live outside the repo, on the user's machine: `C:\Users\shalo\fast_study\radware\` (run 1) and
`…\radware-window\` (run 2 and the flag check); reuse them if a live check is ever needed again.

**How BIU's Radware behaves.** A blocked request gets a 302 to `validate.perfdrive.com/<id>/?ssa=…` or
a 200 `text/html` captcha page; the challenge is an interactive hCaptcha. Cookies: `__uzma` (visitor
id), `__uzmb` (first seen), `__uzmc` (request counter), `__uzmd` (last access), `__uzme`, `__uzmf`,
`uzmx`, plus `__ssds`, `__ssuzjsr0` and `…j0` variants after a solve — persistent cookies (about a
year, on the 2026-10-11 run) kept in the window's profile and bound to neither IP nor UA; the verdict lives in Radware's cloud, keyed to visitor id, UA and IP (ShieldSquare's own
connector, `shieldsquare-connectors` `classes/ShieldSquare/API.php`). A burst of automated calls
triggers a block that outlasts 15 minutes (Node stayed blocked through 14-minute runs three times the
same day). Every non-browser client is blocked whatever it sends; the user's normal browser and the
solved window are not, so the block is not per-IP.

**Run 1 — where clearance works** (60 s between calls):

| Call                                                                         | Result                    |
| ---------------------------------------------------------------------------- | ------------------------- |
| Node 24.20.0 `fetch`, MoodleMobile UA, no cookies (control ×3)               | BLOCKED 302               |
| page `fetch` inside the headed Chrome where the user solved, browser's UA    | **PASS**                  |
| same page `fetch`, UA overridden to MoodleMobile via CDP                     | BLOCKED (opaqueredirect)  |
| Playwright `context.request` (Node TLS + the browser's live cookies), MM UA  | BLOCKED 302               |
| Node and Electron-as-Node, solved cookies + MM UA, or + browser UA, or none  | BLOCKED 302 (all)         |
| headed Chrome relaunched on the same persistent profile, page fetch          | **PASS**                  |
| headless Chrome relaunched on the same profile (`HeadlessChrome` UA)         | BLOCKED                   |

So clearance only works inside the browser: what Node cannot copy is its TLS/HTTP fingerprint or other
state, and `context.request` / `APIRequestContext` sends through Node's `https` sharing only the cookie
jar — never use it as the route. It is tied to the UA it was solved under (a page fetch cannot set one anyway:
Chrome drops it). System Node and Electron's Node get the same verdicts, so dev predicts the packaged
app. It survives a headed relaunch on the same profile (`MoodleSessionprod` is dropped, the `__uzm*`
clearance kept); headless never passes. A UA set at launch to the real UA plus ` MoodleMobile` passes
(2026-10-11, Chrome 154, `sec-ch-ua` unchanged: one captcha, then every page call reached Moodle), so
the window launches with it. The same run confirmed the site's scripts replace the page's `fetch` and
`XMLHttpRequest.prototype.send`, and that the hidden iframe's native `fetch` carries both a WS GET
and a form-encoded WS POST.

**Run 3 — the WS API from plain Node** (2026-10-12, no cookies, no browser, `tool_mobile_get_content`):

| Headers                                                                  | Result                       |
| ------------------------------------------------------------------------ | ---------------------------- |
| none (Node's default UA)                                                 | PASS                         |
| `User-Agent: MoodleMobile 4.4.0 (44000)` (FastStudy's)                   | PASS                         |
| the Android app WebView's UA only                                        | PASS                         |
| `X-Requested-With: com.moodle.moodlemobile` + `Origin: http://localhost` | **WALLED** (302 → perfdrive) |
| every Android app header                                                 | PASS                         |
| Windows `curl.exe` with the Android headers (×2)                         | PASS                         |
| Node with a solved window's Radware cookies                              | PASS                         |

So Node keeps `APP_USER_AGENT` and adds no headers (the WebView's made it worse). Radware's verdicts
change over time — plain Node was walled on the WS API before and is not now — which is why every
call still goes through `moodleFetch`, Node first and the challenge window on a wall.

**Why no autologin.** `tool_mobile_get_autologin_key` succeeds on BIU, but its `autologin.php`
navigation answers `404` with Moodle's `ipmismatch`: the key is bound to `getremoteaddr()`, which
behind Radware's proxy sees varying egress IPs. That is server-side, and BIU's Microsoft Entra
tenant forces a fresh sign-in after a browser restart, so no browser holds a Moodle session for long;
the handler call above needs neither.

**Rejected.** TLS impersonation (curl_cffi, curl-impersonate): field reports say Radware still blocks
it, and it adds an installer binary. Switching the UA mid-session: walled (run 1). Posing as the
Android app in headers: walled (run 3); only the handler's args name the app, since it crashes when
fed less. Spoofing `X-Forwarded-For` around `ipmismatch`: out of bounds.

**Prior art.** moodle-dl (C0D3D3V/Moodle-DL) has no `videostream` or Radware support; a browser UA
with `MoodleMobile` appended comes from it.

**Live checks.** Only the user runs them, on Windows, never this repo's tests (they stub `fetch` and
Playwright, see `test/challenge.test.js`). A check closes FastStudy first, uses a fresh temporary
profile rather than `moodle-profile`, runs as `ELECTRON_RUN_AS_NODE=1` FastStudy.exe importing the
installed `resources\auto\node_modules\playwright`, waits 30 s between requests with no loops or
retries, and never prints or writes a token, key or cookie value.

**Run 2 — window state** (Chrome 154 via `launchPersistentContext`, headed, `viewport:null`):

| Step                                                                     | Bounds (CDP)                 | Result   |
| ------------------------------------------------------------------------ | ---------------------------- | -------- |
| page fetch, visible, after the solve                                     | `normal@350,31`              | **PASS** |
| page fetch, minimized via `setWindowBounds {windowState:'minimized'}`    | `minimized`                  | **PASS** |
| page fetch, moved to `{left:-32000, top:-32000}`                         | `normal@-13107,-13107`       | **PASS** |
| user clicks the taskbar icon, then a fetch                               | stays `normal@-13107,-13107` | **PASS** |
| user closes the window; next call from Node                              | —                            | BLOCKED  |
| relaunch on the same profile, root navigation                            | lands on the site, no captcha | **PASS** |
| page fetch in the relaunch, then again off-screen                        | `-1022,0`, then `-13107`     | **PASS** |

**Launch-flag check** (`about:blank` only), relaunching a profile whose saved position is…

| Saved position      | Relaunch args                     | Relaunch bounds          | On screen?               |
| ------------------- | --------------------------------- | ------------------------ | ------------------------ |
| off-screen (-13107) | `--window-position=-32000,-32000` | `normal@-13107,-13107`   | no, and no flash         |
| on-screen (100,100) | `--window-position=-32000,-32000` | `normal@-13107,-13107`   | no                       |
| off-screen (-13107) | none                              | `normal@-1021,0` (w 1052) | **yes, a ~31 px strip** |

A minimized or off-screen window keeps passing (the page reports `visibilityState=visible` and
`hasFocus()=true` throughout, likely Playwright's focus emulation). Off-screen beats minimized: a
taskbar click restores a minimized window but leaves an off-screen one where it is. Chrome clamps
every off-screen request to -13107, which is still far off-screen. `--window-position` wins over the
profile's saved position, while without it Chrome pulls a saved off-screen window back to a visible
strip, hence the flag on every launch. A closed window reopened on the profile needs no new captcha
while the clearance lasts.

**History.** On 2026-09-07 the app worked again some time after the user solved a captcha in a WSL
browser; nothing committed then touched the WS transport, so the block most likely expired by itself.
An uncommitted attempt that routed every WS call through a Chrome page parked on the site was dropped.

## Constraints

- **Token lifetime** — 12 weeks by default, admin-configurable, and revoked on password change. An
  `invalidToken` shows Reconnect (one MFA); expected, not an error.
- **Recordings in summaries** — unconfirmed against a course that actually posts `rec/share` links:
  the sample course's recordings section was empty and its recitation zoom link was a _meeting_.

## Left out deliberately

- **Caching the `.mp4` URL across restarts** (it is permanent): add if re-resolving the same lectures
  shows up as Radware walls.
- **HLS/Vimeo sources via yt-dlp**: add when a `videostream_no_mp4` report names such a source.
- **Moodle's own subtitles** (`local/video_directory/subs.php`, in the same reply): add if the
  pipeline ever wants them over Whisper.
- **Whether `context.newPage()` flashes a visible window** in headed persistent Chrome is unverified on
  Windows. Open it off-screen explicitly if users see one.
