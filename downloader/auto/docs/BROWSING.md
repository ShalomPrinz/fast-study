# Discovery, listing & expansion

`listRecordings` (`core.js`) enumerates a navigated course page; `expandTiles` runs first, then two DOM parsers merge, then each activity routes to an extractor.

## Tile expansion

BIU runs Moodle **format_tiles**, which injects each section's body (activities AND summary) into the DOM only when its tile is clicked — so an unexpanded course parses as empty ("No recordings found"). `expandTiles` (`moodleCourse.js`) clicks every `#tile-N` / `.tile[data-section]` and waits for that section's content. No-op on non-tiles formats; per-tile failures swallowed; already-loaded sections skipped.

## Two merged parsers

- `parseMoodleCourse` — walks `li.activity` module cards → `videostream` / `url` activities.
- `parseZoomSections` — scans `li.section .summary` for `zoom.us/rec/share` links (`<a href>` or bare text), pairing each with its preceding `הרצאה מספר N` label, minting a synthetic `modType:'zoom'` activity.

These are the single merge point; zoom-share links live in summaries, not activity cards, so the module parser never sees them.

## Keyword gating

`isRecording(sectionName, title)` matches `RECORDING_KEYWORDS` (הקלטות/הרצאות/תרגולים/… /recording/lecture, case-insensitively) over the activity title AND its section/tile heading. **Only the `url` extractor is gated.** A Moodle `url` module is an opaque off-site link — a YouTube playlist, but equally a syllabus, reading, or Drive folder — so unfiltered every `url` got optimistically surfaced and blew up on expand. `videostream` (in-site video, matched by module type) and `zoom` (synthetic, minted only from a real `zoom.us/rec/share` link) are already unambiguous.

## Mechanism-agnostic Item / ref contract

The frontend never sees the download mechanism. `/list` and `/list/expand` return uniform `Item = { ref, title, kind, expandable }`. `ref` opaquely encodes the internal `Recording` (base64url JSON, `src/ref.js`) — stateless, no server-side map; the frontend round-trips it and never parses it. `strategy`/`pageUrl`/`videostream`/`youtube`/`playlist`/`zoom`/`passcode` must never appear in a response.

## Lazy expansion

An unexpanded playlist (`url` module) lists as ONE `expandable` item. `/list/expand` follows the Moodle `?redirect=1` hop (read at `waitUntil:'commit'` so a heavy non-YouTube target can't hang), confirms the host is YouTube, then flat-lists entries with `yt-dlp --flat-playlist`. A redirect to a non-YouTube host is a `422 {status:'unsupported'}` (a genuinely-unsupported source, distinct from a 500 "try again"); the same mapping applies on `/download-item`.
