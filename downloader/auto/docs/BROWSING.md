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

Every strategy but `moodle-file` and `google-drive` resolves a video that lands as the lecture's `video.mp4`; `moodle-file` resolves a PDF that lands as one of its materials — the same slot the Chrome extension uploads to manually; a `google-drive` link could be either, and only the download-time probe knows which. Only `kind` (`lecture`/`recitation`) picks the folder; the media type picks the endpoint `server/` uses (`/download-file` vs `/download`+`/download-youtube`), and the database names the file. A second PDF into one lecture appends (`material.2.pdf`) rather than overwriting.

## Three download entry points

`core/core.js` exports one function per download shape, and `/download-item` picks between them
in the strategy branching it already does: `downloadRecording(page, …)` (the browser-capture
dispatcher — `videostream`, `zoom`), `downloadMoodleFile(…)` and `downloadYtDlp(…)`. The split
is by *needs a browser*, not by strategy count: a browserless strategy has no page to carry its
credential, so it must take one explicitly (`downloadMoodleFile`'s required `wstoken`).
The browserless pair each resolve exactly one target, so `only` (azoom-split notion) doesn't apply to them; all three share the replay cache and `fromCache`.

All three posts (`src/http/serverClient.js`) return `server/`'s job id, and all three throw when a
200 carries none: `server/` mints the id synchronously in its route (`createJob`, before the size
probe) and always returns it, and every validation failure is a 4xx `postJson` already throws on —
so a missing `jobId` is a `server/` contract violation, not a normal outcome to hand back as a
silent "nothing started". The throw lands on `app.js`'s centralized backstop, which turns it into a
500 with that message, the same rail as any other unexpected failure.

## Mechanism-agnostic Item / ref contract

The frontend never sees the download mechanism. `/list` and `/list/expand` return uniform `Item = { ref, title, kind, media, resolvedMedia?, expandable, section }`. `media` is `'video'`, `'material'` or `'unknown'` — which file lands on disk, never how it is fetched, so it stays mechanism-agnostic; a `material` item is never `expandable`. Every `google-drive` row is `'unknown'`: the WS payload carries no filename and `/list` never probes, so that is the honest stamp. `resolvedMedia` is the optional sibling saying what a row was actually probed as this session (`'video'`, `'material'`, or `'unsupported'` for a real file this service can't use); it is absent for a row never probed and for every non-Drive row, and a resolved row keeps its original `media` rather than moving segments. `ref` opaquely encodes the internal `Recording` (base64url JSON, `src/lib/ref.js`) — stateless, no server-side map; the frontend round-trips it and never parses it. `section` is display metadata — the Moodle course section heading (`section.name`) the item lives under, a sibling field the frontend groups by (never parsed out of `ref`); `''` when the section is unnamed. Expanded playlist children inherit their parent's `section`. `strategy`/`pageUrl`/`videostream`/`youtube`/`playlist`/`zoom`/`passcode` must never appear in a response.

## Lazy expansion

An unexpanded playlist (`url` module) lists as ONE `expandable` item. Its `pageUrl` is the
module's **direct external target** (`contents[0].fileurl`) — no redirect hop. `/list/expand`
runs `yt-dlp --flat-playlist` straight on that URL. Non-YouTube targets are already filtered at
list time by `canHandle` (see Keyword gating), so the YouTube-host check in `listEntries` is now
a fallback: an echoed ref can still reach expand/download, and a non-YouTube (or unparseable)
host there is a `422 {status:'unsupported'}` (a genuinely-unsupported source, distinct from a 500
"try again"); the same mapping applies on `/download-item`.

A `google-drive` item is **not** expandable — it is one concrete file. Nothing in the WS payload
says _what_ that file is (a Drive link in a recordings section is as easily `L1.zip` as a
lecture video), so `/download-item` skips the browser and probes the file's real name first
(`probeDriveFile`), then routes on its extension: `.mp4`/`.mkv`/`.mov`/`.webm`/`.m4v`/`.avi` →
`server/`'s `/download-youtube` (yt-dlp on the `pageUrl`), `.pdf` → `/download-file` as one of the
lecture's materials, anything else → `422 {status:'unsupported'}` naming the actual extension.
The probe reads `Content-Disposition` off `uc?export=download&id=<ID>` (one request; a large
file's confirm interstitial and `/file/d/<ID>/view`'s `<title>` are the fallbacks) — the filename
is a fact about the file, unlike yt-dlp's stderr wording. A file that isn't shared "anyone with
the link" (or was removed) yields no name at all and is the same 422, naming Drive sharing and
the URL. `server/`'s download job is fire-and-forget, which is why all of this is decided here.
Results are memoized per Drive **file id** for the session (`src/core/driveProbeCache.js`), and
`/download-item` echoes the resolved `media` back. `/list` never probes — it costs an
HTTP round-trip per row — but it reads that cache to stamp `resolvedMedia` on rows already probed,
so the resolved type survives a re-list.

A `moodle-file` item is likewise not expandable and skips the browser: `/download-item` resolves the
university from the ref's `fileurl`, appends the WS token via `pluginfileUrl` (pluginfile authenticates
by query-string token, and `fileurl` may already carry `?forcedownload=1`), and posts that URL to
`server/`'s `/download-file`. Going through a tracked job rather than a blocking fetch buys the PDF the
same progress/retry/`ref`-grouping as a video. A missing token is `401 {status:'reconnect'}`, same as
`/list`. A *dead* one needs a one-byte preflight (`assertPluginfileReadable`) because pluginfile answers
it with **HTTP 200 + Moodle's JSON exception body**, never a 403: unchecked, `server/`'s fire-and-forget
job saves that blob as a material and reports success. The preflight turns it back into
`invalidtoken` → `markExpired` + reconnect. The resolved `{url}` cap is cached like any other, so a retry
replays it and `fromCache` lets `server/` re-capture silently when the token has since expired.
