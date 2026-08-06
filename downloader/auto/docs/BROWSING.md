# Discovery, listing & expansion

`listRecordings(sections)` (`core/core.js`) enumerates a course from the stateless WS
`core_course_get_contents` result — no browser, no navigation. Two parsers merge over that
JSON, then each activity routes to an extractor.

## Two merged parsers

- `mapModules` (`core/core.js`) — flattens each `section.modules[]` into `videostream` / `url` /
  `resource` activities. A `url` module's external target is `contents[0].fileurl`. A `resource`
  module is the one type that can hold **several** files, so it emits one activity per
  `contents[]` entry with `type:'file'` (carrying that file's `fileurl`/`filename`/`mimetype`);
  every other modType emits exactly one. A multi-file resource appends the filename to the module
  name so its rows are distinguishable.
- `parseZoomSummaries` (`discovery/zoomSection.js`) — runs the same regex / `הרצאה מספר N`
  label / dedup-by-share-token logic over each `section.summary` **HTML string**, emitting a
  synthetic `modType:'zoom'` activity per `zoom.us/rec/share` link.

These are the single merge point; zoom-share links live in section **summaries**, not module
cards, so the module parser never sees them.

WS `section.name` / `module.name` are HTML strings (Moodle wraps subsection headings in
`<span class="course-mod_subsection">…</span>`), so both parsers flatten them through
`stripTags` (`lib/html.js`) before they become `sectionName`/`title` — the frontend renders
those as text, and the keyword gate matches over them.

## Keyword gating

`isRecording(sectionName, title)` matches `RECORDING_KEYWORDS` (הקלטות/הרצאות/תרגולים/… /recording/lecture, case-insensitively) over the activity title AND its section heading. **Only the `url` extractors are gated**, and each is gated twice: a recording keyword AND a target check. A Moodle `url` module is an opaque off-site link — a YouTube playlist or a Drive video, but equally a syllabus, reading, Google Doc, or Drive folder — but its external target (`contents[0].fileurl`) is known at list time with no fetch/redirect hop, so the target check is a pure function of the URL:

- `YoutubePlaylistExtractor` — `YOUTUBE_HOSTS.has(safeHost(externalUrl))`.
- `GoogleDriveExtractor` — a Drive host (`drive.google.com`/`docs.google.com`) **and** a single-file path (`/file/d/<id>/…`, `/open?id=`, `/uc?id=`). The path half carries real weight: a Google Doc titled `…לתרגילים` passes the keyword gate, and only the path check keeps it unclaimed. Folder links (`/drive/folders/<id>`) are likewise unclaimed.

Any other target (GitHub, unparseable) is not claimed at all — skipped like a syllabus link — rather than surfaced and rejected on expand. `videostream` (in-site video, matched by module type) and `zoom` (synthetic, minted only from a real `zoom.us/rec/share` link) are already unambiguous.

## Mimetype gating (`resource` files)

`MoodleFileExtractor` claims a `resource` activity on `mimetype === 'application/pdf'` alone — deliberately **not** keyword-gated like the `url` extractors. A mimetype is exact where a keyword is a guess, and the two error directions are not symmetric: a listed grade-sheet PDF costs one ignored row, a missed slide deck costs the material. Non-PDF resource files (docx, zip) stay unclaimed.

## Video vs material

Every strategy but `moodle-file` resolves a video that lands as the lecture's `video.mp4`; `moodle-file` resolves a PDF that lands as its `material.pdf` — the same file the Chrome extension uploads manually. Only `kind` (`lecture`/`recitation`) picks the folder; the media type picks the filename, and `server/` decides it from the endpoint (`/download-file` vs `/download`+`/download-youtube`). A second PDF into one lecture overwrites the first.

## Mechanism-agnostic Item / ref contract

The frontend never sees the download mechanism. `/list` and `/list/expand` return uniform `Item = { ref, title, kind, media, expandable, section }`. `media` is `'video'` or `'material'` — which file lands on disk, never how it is fetched, so it stays mechanism-agnostic; a `material` item is never `expandable`. `ref` opaquely encodes the internal `Recording` (base64url JSON, `src/lib/ref.js`) — stateless, no server-side map; the frontend round-trips it and never parses it. `section` is display metadata — the Moodle course section heading (`section.name`) the item lives under, a sibling field the frontend groups by (never parsed out of `ref`); `''` when the section is unnamed. Expanded playlist children inherit their parent's `section`. `strategy`/`pageUrl`/`videostream`/`youtube`/`playlist`/`zoom`/`passcode` must never appear in a response.

## Lazy expansion

An unexpanded playlist (`url` module) lists as ONE `expandable` item. Its `pageUrl` is the
module's **direct external target** (`contents[0].fileurl`) — no redirect hop. `/list/expand`
runs `yt-dlp --flat-playlist` straight on that URL. Non-YouTube targets are already filtered at
list time by `canHandle` (see Keyword gating), so the YouTube-host check in `listEntries` is now
a fallback: an echoed ref can still reach expand/download, and a non-YouTube (or unparseable)
host there is a `422 {status:'unsupported'}` (a genuinely-unsupported source, distinct from a 500
"try again"); the same mapping applies on `/download-item`.

A `google-drive` item is **not** expandable — it is one concrete file, downloadable straight from
its `pageUrl`. `/download-item` skips the browser entirely and hands that URL to `server/`'s
`/download-youtube` (yt-dlp), after a `yt-dlp --skip-download --print id` preflight
(`assertPubliclyShared`): `server/`'s download job is fire-and-forget, so a file that isn't shared
"anyone with the link" is caught here and surfaces as `422 {status:'unsupported'}` naming Drive
sharing and the URL; any other yt-dlp failure stays a 500.

A `moodle-file` item is likewise not expandable and skips the browser: `/download-item` resolves the
university from the ref's `fileurl`, appends the WS token via `pluginfileUrl` (pluginfile authenticates
by query-string token, and `fileurl` may already carry `?forcedownload=1`), and posts that URL to
`server/`'s `/download-file`. Going through a tracked job rather than a blocking fetch buys the PDF the
same progress/retry/`ref`-grouping as a video. A missing token is `401 {status:'reconnect'}`, same as
`/list`. A *dead* one needs a one-byte preflight (`assertPluginfileReadable`) because pluginfile answers
it with **HTTP 200 + Moodle's JSON exception body**, never a 403: unchecked, `server/`'s fire-and-forget
job saves that blob as `material.pdf` and reports success. The preflight turns it back into
`invalidtoken` → `markExpired` + reconnect. The resolved `{url}` cap is cached like any other, so a retry
replays it and `fromCache` lets `server/` re-capture silently when the token has since expired.
