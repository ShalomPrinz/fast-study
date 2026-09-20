# Discovery, listing & resolve

`listRecordings(sections)` (`core/core.js`) enumerates a course from the stateless WS
`core_course_get_contents` result — no browser, no navigation. Two parsers merge over that JSON,
then each activity routes to the first extractor in `core/registry.js` whose `canHandle` claims it.

## Two merged parsers

- `mapModules` (`core/core.js`) flattens each `section.modules[]` into activities. A `url` module's
  external target is `contents[0].fileurl`. A `resource` module is the one type that can hold
  **several** files, so it emits one activity per `type:'file'` entry, appending the filename to the
  title only when there are several.
- `parseZoomSummaries` (`discovery/zoomSection.js`) walks each `section.summary` **HTML string**,
  tracking the latest `הרצאה מספר N` label and emitting one synthetic `modType:'zoom'` activity per
  `zoom.us/rec/share` link, deduped by share token. Zoom links live in summaries, not modules.

WS names are HTML (Moodle wraps subsection headings in `<span class="course-mod_subsection">`), so
both parsers flatten them through `stripTags` (`lib/html.js`) before they become titles or headings.

## Every `url` module is listed

A `url` module is an opaque off-site link — a playlist or a Drive video, but equally a syllabus, a
Google Doc or a Drive folder. Its target is known at list time with no fetch, so **the target URL is
the only thing routing reads**:

- `YoutubePlaylistExtractor` — a YouTube host.
- `GoogleDriveExtractor` — a Drive host **and** a single-file path (`/file/d/<id>/…`, `/open?id=`,
  `/uc?id=`).
- `DirectUrlExtractor` — registered **last**: any other absolute `http(s)` target, a Drive _folder_
  included. Lists as `'unknown'` and lets the download-time probe answer.

A non-`http(s)` target (`mailto:`, relative, junk) is claimed by nobody and skipped. There is **no
keyword gate**: a keyword is a guess about content made from a title, and gating on it dropped real
videos with terse titles while letting archives through. `isRecording` (`discovery/moodleCourse.js`)
still matches `RECORDING_KEYWORDS` over title and heading, but only as the `likelyRecording` hint the
frontend uses to group a stray link under a synthetic "Other links" heading.

A future share-page extractor (Dropbox `?dl=1`, OneDrive, a Docs export) registers **before**
`DirectUrlExtractor` with its own resolve branch; until then those pages probe as `text/html` and
grey in place as unsupported.

## Mimetype gating (`resource` files)

`MoodleFileExtractor` claims a `resource` file on `mimetype === 'application/pdf'` alone. A mimetype
is exact, and the errors aren't symmetric: a listed grade-sheet PDF costs one ignored row, a missed
slide deck costs the material. Non-PDF files stay unclaimed.

## The `Item` / `ref` contract

The frontend never sees the mechanism. `/list` and `/list/expand` return
`Item = { ref, title, kind, media, resolvedMedia?, expandable, section, likelyRecording }`:

- `media` — which file lands (`'video'` = `video.mp4`, `'material'` = a lecture PDF), never how it is
  fetched. `'unknown'` for every `google-drive` and `direct-url` row: the WS payload names no file
  and `/list` never probes (a round-trip per row). A `material` item is never `expandable`.
- `resolvedMedia` — what a row was probed as this session (`'video'`, `'material'`, or
  `'unsupported'`), read off the probe cache so it survives a re-list; absent when never probed. A
  resolved row keeps its original `media` rather than moving segments.
- `ref` — the internal `Recording`, base64url JSON (`src/lib/ref.js`): stateless, round-tripped,
  never parsed by the frontend. `strategy`/`pageUrl`/`passcode` and the like must never appear in a
  response outside it.
- `section` — the Moodle section heading, `''` when unnamed; display metadata the frontend groups by.
- `likelyRecording` — the keyword hint; `false` only for a `url` module that reads like a stray link.
  Every other strategy is unambiguously a recording.

Expanded playlist children inherit their parent's `section` and `likelyRecording` — one video title
says nothing on its own.

## Resolve entry points

`core/core.js` exports one function per resolve shape: `resolveRecording(page, …)` (browser capture:
`videostream`, `zoom`), and the browserless `resolveMoodleFile`, `resolveYtDlp`, `resolveDriveFile`,
`resolveDirectUrl`. The split is by _needs a browser_: a browserless strategy has no page to carry
its credential, so it takes one explicitly (`resolveMoodleFile`'s required `wstoken`). The browserless
ones resolve exactly one target, so `only` doesn't apply; all share the replay cache and stamp
`fromCache`. Each returns targets (`core/targets.js`), and `toolFor` picks `server/`'s downloader:
`curl` replays captured headers, `ytdlp` resolves a YouTube/Drive/direct video page, `fetch` takes a
plain tokened URL.

Only `kind` (`lecture`/`recitation`) picks the folder; the database names the file, so a second PDF
into one lecture appends (`material.2.pdf`).

## YouTube playlists — lazy expansion

An unexpanded playlist lists as ONE `expandable` item whose `pageUrl` is the module's direct
target. `/list/expand` runs `yt-dlp --flat-playlist` on it, spreading `NO_WINDOW` from
[`@faststudy/tools`](../../../lib/tools/CLAUDE.md). The YouTube-host check in `listEntries` is a
fallback for an echoed ref: a non-YouTube host there is `422` (`expand_unsupported_host {host}`),
distinct from a 500 "try again".

## Google Drive — the filename probe

A Drive item is one file, but nothing in the WS payload says _what_ (a Drive link in a recordings
section is as easily `L1.zip`). `server/`'s job is fire-and-forget once started, so `/resolve` decides
here: `probeDriveFile` reads the real filename and routes on its extension via `classifyFilename`
(`lib/fileMedia.js`) — video → a `ytdlp` target on the Drive link itself, `.pdf` → a `fetch` target on the
direct-download URL, anything else → `422` (`link_not_a_video {source:'drive', url, ext}`) naming the
extension. The filename is a fact about the file, unlike yt-dlp's stderr wording.

The name comes from `Content-Disposition` on `uc?export=download&id=<ID>` (one request); a large
file's confirm interstitial and `/file/d/<ID>/view`'s `<title>` are the fallbacks. A file not shared
"anyone with the link" (or removed) yields no name and is a `422` (`drive_not_shared {url}`) naming
the sharing cause and the URL.
Every verdict, the unshared one included (`reason:'unshared'`), is memoized per **file id** in
`core/probeCache.js`; `forceCapture` re-probes — the way back in once the owner shares it.

## Direct URLs — the generic probe

`probeUrl` (`lib/probeUrl.js`, no browser, never throws) asks the host once — `HEAD`, with a ranged
one-byte `GET` for hosts that reject HEAD, following redirects — and weighs three pieces of evidence,
strongest first:

1. the `Content-Disposition` filename — the host naming the file. It beats the type: `L1.zip` under a
   sloppy `video/mp4` is still a definite no.
2. `Content-Type` — `text/html` is a definite no (a login wall, a share page, a syllabus).
3. the URL's own filename (the redirect target's first), as a **fallback only**: an SSO-walled
   `…/syllabus.pdf` answers `200 text/html` with the login page, and `curl -L --fail` would save that
   as the material. The type vetoes the guess, which is why the URL is never read first.

All of it routes through the one table in `lib/fileMedia.js`, so a Drive link and a plain URL can
never disagree about what a `.mp4` is.

A **certain** verdict — usable, a definite no, or a `404`/`410` (`reason:'missing'`: the host says
nothing is there) — memoizes under the normalized URL and a no answers `422`: `link_dead {url}` for
the missing one, else `link_not_a_video {source:'link', url, ext}`, whose `ext` is null for a web page.
An **uncertain** one — nothing answered (offline, DNS, TLS, the 15s timeout Node's `fetch` lacks by
default), a refusal that can pass (`403` wall, `429`, `5xx`), or bare `application/octet-stream` with
no name — is a plain `500` `link_probe_inconclusive {url}` "try again" and is **not cached**: a 422 disables the row for the session, which must not be the price
of one bad moment on the network.

## Moodle files

Browserless: `/resolve` finds the university from the ref's `fileurl`, appends the WS token via
`pluginfileUrl`, and returns a `fetch` target — a tracked job, so a PDF gets the same progress, retry
and `ref` grouping as a video. A missing token is `401`. A _dead_ one needs the one-byte preflight
`assertPluginfileReadable`, because pluginfile answers it with HTTP 200 + a JSON exception body that
`server/`'s job would save as the material ([MOODLE.md](MOODLE.md)). The cap is cached like any other,
so `fromCache` lets `server/` re-resolve silently once the token has expired.
