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

Every other `url` module — any absolute `http(s)` target, whatever the host — falls to `DirectUrlExtractor`, registered **last** in `EXTRACTORS` so the two above keep their own targets. It claims on the URL scheme alone and lists the row as `'unknown'`: nothing in the WS payload says what an off-site link is, and a title is a guess, so the download-time probe answers instead of the listing dropping the row. A non-`http(s)` target (`mailto:`, a relative path, junk) is claimed by nobody and skipped. `videostream` (in-site video, matched by module type) and `zoom` (synthetic, minted only from a real `zoom.us/rec/share` link) are already unambiguous.

Adding a share-page extractor later (Dropbox `?dl=1`, OneDrive `?download=1`, a Docs export) means registering it **before** `DirectUrlExtractor` and giving it its own resolve branch; until then those pages probe as `text/html` and grey in place as unsupported.

## Mimetype gating (`resource` files)

`MoodleFileExtractor` claims a `resource` activity on `mimetype === 'application/pdf'` alone — deliberately **not** keyword-gated like the `url` extractors. A mimetype is exact where a keyword is a guess, and the two error directions are not symmetric: a listed grade-sheet PDF costs one ignored row, a missed slide deck costs the material. Non-PDF resource files (docx, zip) stay unclaimed.

## Video vs material

Every strategy but `moodle-file` and `google-drive` resolves a video that lands as the lecture's `video.mp4`; `moodle-file` resolves a PDF that lands as one of its materials — the same slot the Chrome extension uploads to manually; a `google-drive` link could be either, and only the download-time probe knows which. Only `kind` (`lecture`/`recitation`) picks the folder; the media type picks the `tool` each resolved target names (`fetch` vs `curl`/`ytdlp`), and the database names the file. A second PDF into one lecture appends (`material.2.pdf`) rather than overwriting.

## Five resolve entry points

`core/core.js` exports one function per resolve shape, and `/resolve` picks between them in the
strategy branching it already does: `resolveRecording(page, …)` (the browser-capture dispatcher —
`videostream`, `zoom`), `resolveMoodleFile(…)`, `resolveYtDlp(…)`, `resolveDriveFile(…)` and
`resolveDirectUrl(…)`. The
split is by _needs a browser_, not by strategy count: a browserless strategy has no page to carry
its credential, so it must take one explicitly (`resolveMoodleFile`'s required `wstoken`). The
browserless three each resolve exactly one target, so `only` (a zoom-split notion) doesn't apply to
them; all four share the replay cache and stamp `fromCache` on what they return.

Each returns download **targets**, never a download: `{ name, tool, url, headers?, fromCache }`
(`core/targets.js`), where `tool` is the key of the `server/` downloader that can fetch this cap
(`curl` replays captured headers, `ytdlp` resolves a YouTube/Drive video page, `fetch` takes a
plain tokened URL). `server/` creates and owns the job per target; this service holds no job state.

## Mechanism-agnostic Item / ref contract

The frontend never sees the download mechanism. `/list` and `/list/expand` return uniform `Item = { ref, title, kind, media, resolvedMedia?, expandable, section }`. `media` is `'video'`, `'material'` or `'unknown'` — which file lands on disk, never how it is fetched, so it stays mechanism-agnostic; a `material` item is never `expandable`. Every `google-drive` and `direct-url` row is `'unknown'`: the WS payload carries no filename and `/list` never probes, so that is the honest stamp. `resolvedMedia` is the optional sibling saying what a row was actually probed as this session (`'video'`, `'material'`, or `'unsupported'` for a real file this service can't use); it is absent for a row never probed and for every unprobed strategy, and a resolved row keeps its original `media` rather than moving segments. `ref` opaquely encodes the internal `Recording` (base64url JSON, `src/lib/ref.js`) — stateless, no server-side map; the frontend round-trips it and never parses it. `section` is display metadata — the Moodle course section heading (`section.name`) the item lives under, a sibling field the frontend groups by (never parsed out of `ref`); `''` when the section is unnamed. Expanded playlist children inherit their parent's `section`. `strategy`/`pageUrl`/`videostream`/`youtube`/`playlist`/`zoom`/`passcode` must never appear in a response.

## Lazy expansion

An unexpanded playlist (`url` module) lists as ONE `expandable` item. Its `pageUrl` is the
module's **direct external target** (`contents[0].fileurl`) — no redirect hop. `/list/expand`
runs `yt-dlp --flat-playlist` straight on that URL. Non-YouTube targets are already filtered at
list time by `canHandle` (see Keyword gating), so the YouTube-host check in `listEntries` is now
a fallback: an echoed ref can still reach expand/download, and a non-YouTube (or unparseable)
host there is a `422 {status:'unsupported'}` (a genuinely-unsupported source, distinct from a 500
"try again"); the same mapping applies on `/resolve`.

A `google-drive` item is **not** expandable — it is one concrete file. Nothing in the WS payload
says _what_ that file is (a Drive link in a recordings section is as easily `L1.zip` as a
lecture video), so `/resolve` skips the browser and probes the file's real name first
(`probeDriveFile`), then routes on its extension: `.mp4`/`.mkv`/`.mov`/`.webm`/`.m4v`/`.avi` →
a `ytdlp` target on the `pageUrl`, `.pdf` → a `fetch` target landing as one of the lecture's
materials, anything else → `422 {status:'unsupported'}` naming the actual extension.
The probe reads `Content-Disposition` off `uc?export=download&id=<ID>` (one request; a large
file's confirm interstitial and `/file/d/<ID>/view`'s `<title>` are the fallbacks) — the filename
is a fact about the file, unlike yt-dlp's stderr wording. A file that isn't shared "anyone with
the link" (or was removed) yields no name at all and is the same 422, naming Drive sharing and
the URL. `server/`'s download job is fire-and-forget once started, which is why all of this is decided here.
Every verdict is memoized per Drive **file id** for the session (`src/core/probeCache.js`) —
the unshared one included, stored as `reason:'unshared'` so a repeat attempt 422s with the same
accurate message instead of re-paying the probe; `forceCapture` re-probes it, the way back in once
the owner shares the file. `/resolve` echoes the resolved `media` back. `/list` never probes — it costs an
HTTP round-trip per row — but it reads that cache to stamp `resolvedMedia` on rows already probed,
so the resolved type survives a re-list.

A `direct-url` item is not expandable either, and resolves the same shape as a Drive one with a
generic probe behind it (`src/lib/probeUrl.js`, two tiers, no browser). Tier 1: the URL path
already names a file (`…/lecture3.mp4`, `…/notes.pdf`) → decided from the extension with no
request. Tier 2: one `HEAD` (a ranged one-byte `GET` for hosts that reject HEAD), following
redirects, reading the `Content-Disposition` filename first and the `Content-Type` second. Both
tiers route through the one extension table `classifyFilename` owns (`src/lib/fileMedia.js`), so a
Drive link and a plain URL can never disagree about what a `.mp4` is. `text/html` is a share page
or a syllabus doc → `null`; a network failure → `null` too, never a throw that would kill the
listing. A `null` verdict is `422 {status:'unsupported'}` from `/resolve`, naming what the link
turned out to be. Verdicts memoize under the normalized URL in the same
`src/core/probeCache.js` the Drive probe uses — it is keyed by an opaque **probe key**, the Drive
file id on one side and the URL on the other — so a second attempt on an unsupported row costs no
round-trip, and `forceCapture` re-probes.

A `moodle-file` item is likewise not expandable and skips the browser: `/resolve` resolves the
university from the ref's `fileurl`, appends the WS token via `pluginfileUrl` (pluginfile authenticates
by query-string token, and `fileurl` may already carry `?forcedownload=1`), and returns that URL as a
`fetch` target. Going through a tracked job rather than a blocking fetch buys the PDF the
same progress/retry/`ref`-grouping as a video. A missing token is `401 {status:'reconnect'}`, same as
`/list`. A _dead_ one needs a one-byte preflight (`assertPluginfileReadable`) because pluginfile answers
it with **HTTP 200 + Moodle's JSON exception body**, never a 403: unchecked, `server/`'s fire-and-forget
job saves that blob as a material and reports success. The preflight turns it back into
`invalidtoken` → `markExpired` + reconnect. The resolved `{url}` cap is cached like any other, so a retry
replays it and `fromCache` lets `server/` re-resolve silently when the token has since expired.
