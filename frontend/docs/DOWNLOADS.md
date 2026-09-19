# Downloads page

`/downloads` — connect the BIU account, keep each course's source URL, then discover and download
recordings into the same `DATA_ROOT` courses the pipeline uses. Discovery and auth go to the
auto-downloader (:3053), downloads and bulk runs to the downloader server (:3052); their clients and
error classes are in [SERVICES.md](SERVICES.md). A download's progress is [JOBS.md](JOBS.md), a
section's "Download all" is [BULK.md](BULK.md).

## Layout

A `PageHeader` (account chip, count of courses with a source) over one `CourseSourceRow` per active
course plus `AddCourseRow`, then — once a course is loaded — the `.recordings-panel`. The 880px measure
fits a recording's second line: kind toggle, name input and action side by side.

A source row is three grid tracks with the side ones equal, so every row's URL sits at the midpoint and
lines up down the list; only the action track is floored at its content, so a narrow window costs the
URL its centring rather than sliding the buttons over it. `ModeToggle` emits its segments and body as
siblings, so the panel is a two-column grid: segments and close button on row 1, the body spanning both.

A recording is a two-line card — what it is, then where it is going (`Save as`, kind toggle, name,
action). States are tints: accent while downloading, `--ok` once the target is in the course (an
`In course` chip plus an icon-only `Download again`, always visible so it is keyboard- and
touch-reachable, routed into the overwrite confirm), faded for `unsupported`.

## Auth

`AuthStatusProvider` sits in `Layout` so the header chip and every course row read one `/auth/status`
answer. It probes nothing on mount — `AccountStatus` asks wherever it renders — so a route with no
account control never toasts the auto-downloader as down. `status: null` is "unknown".

Connect pops a headed browser on the host for MFA and returns at once; Done calls `/auth/complete` and
re-probes. Disconnect sits behind a `ConfirmModal`, since getting the token back is another MFA
round-trip. Both settings screens reuse `AccountStatus` with the `--danger` tone retoned
([SETTINGS.md](SETTINGS.md)) — only this page is blocked by a missing session.

A `ReconnectError` anywhere toasts a hint and bumps `reconnectKey`, the `key` on `<AccountStatus>`:
remounting re-runs the probe, since the cached status predates the 401. That is why the probe lives in
the component, not the never-remounting provider. A `BlockedError` (the site's bot protection answering
a burst with a captcha) is deliberately not that path: it says nothing about the token, so it toasts
`blockedMessage()` and leaves the chip alone.

`Load recordings` disables only on `connected: false`; unknown leaves it enabled, since guessing
"disconnected" from an unanswered probe would lock a working session out.

## The page session

`DownloadsSessionProvider` (in `Layout`) holds everything the page accumulates — `selected`/`pending`,
`items`, `error`, row edits, `reconnectKey`, plus `discover` and `close` — so a trip to a lecture and back
finds the same course and typed names, and a discovery in flight when the user leaves still lands. State
and an identity-stable actions bag are separate contexts; the memoized rows bail out on the setters'
identity.

`discover` sets `pending` and promotes the course to `selected` only once `listRecordings` resolves, so
an expired session or a `BlockedError` leaves the page as it was, a toast and nothing else. A plain
failure does promote it: the panel is where that error shows. Each discovery takes a ticket; `close` or
another course bumps it, so an answer the user walked away from writes nothing. The reconnect hint is
the exception — an expired session is true whichever discovery found it.

## Discovery

`listRecordings(sourceUrl)` returns a flat `Item[]` in page order. `media` is `'video'` (lands as
`video.mp4`), `'material'` (a Moodle PDF, appended as the next `material.N.pdf`) or `'unknown'` (a
Google Drive row — no filename, so only a download-time probe can tell). The destination is derived
server-side from the opaque `ref`; the frontend branches its own affordances on `media` and never sends
it.

A `ModeToggle` splits the three segments, each with its count, and `groupSections(items, media)` filters
by media _before_ grouping by Moodle heading (first-seen order, blank → "Other"), so a section with
nothing on the active side does not render and "Download all" covers one media only.

A row auto stamps `likelyRecording: false` (a `url` module with no recording keyword) moves into a
synthetic **Other links** bucket, placed last — this keeps stray links out of the lecture sections, and
on Unknown keeps "Download all" from serially probing each one. The bucket is marked `synthetic`, never
recognised by title, and has **no run identity**: `section.id = null`, no "Download all", out of every
bulk queue. Giving it an id would collide with a real heading of the same name in the server's run map.
`useSectionRun(null)` reads as "no run".

A playlist row is `expandable`. Expansion state and fetched children live in a module store
(`RowExpansionsContext.ts`), not the row: the bulk queue needs resolved children, "Download all" needs to
know every playlist is expanded, and the state must survive a segment switch. Each row subscribes to its
own ref; children are cached on first expand; the session's `clear()` calls `clearExpansions()`.

Each section header's caret + title is a toggle that hides (never unmounts) everything below it — the
rows and the passcode prompt hold in-flight state. Collapsed keys live in
a sibling module store (`SectionCollapseContext.ts`, keyed `section.id`, or `course:media` for the synthetic pile, open by
default), so they survive a segment switch; `clear()` resets it, and a paused run re-opens its section so
the passcode prompt can't stay hidden.

## Unknown rows

An `unknown` row carries a chip — `?`, then `Video` / `Material` / `Unsupported` — and **never changes
segment** once resolved. `resolvedMedia` comes from auto's session probe cache on listing, or from a
download: `POST /download-item`'s `media` and a 422 `UnsupportedError` are both verdicts, reported
through the dispatch-only `ResolvedMediaContext` and stamped onto the item. It sits above the segments
because a segment switch unmounts every row. A row resolved to `material` gets the whole material
affordance; an `unsupported` one fades with Download disabled.

## Row name and kind

`RowEditsContext` stores **only overrides** (`{ name?, kind? }` per `ref`); `resolveRow` derives the
displayed values from the override plus the live tree. So an untouched name keeps tracking the kind
toggle, and the green row and the bulk skip read the same resolved values. Edits persist for the whole
course (SSE refresh, segment switch, navigation) and reset on another course or close, so refs never
collide. State and dispatch are split: only `SectionGroup` and `ChildRows` subscribe to the map, and the
memoized `RecordingRow` takes its slice as a prop, so a keystroke re-renders one row.

**The server owns the on-disk spelling.** Both submit endpoints canonicalize names (`:` is illegal on
NTFS) and answer `renames`; `applyRenames` writes them back through `setName` with one toast per
submission. The stored name is then the on-disk one, which is what lets every "already there" check
match — no client-side sanitizing, which would only hide the desync.

`hasResource(item, name, kind, courses, course)` is the single already-downloaded rule: the named node
holds `video.mp4` for a video, any material for a material. An unprobed `unknown` or an `unsupported` row
is always false rather than ever showing a wrong "downloaded". A video row on an existing target confirms
overwrite; `splitSiblings` also catches `${name}.1`/`.2` (a zoom row splits into those) with a "might
overwrite" confirm. **A material row never confirms** — it appends, and shows the target's material
count instead.

## Material rows and name suggestion

A material row's destination is a native `<input list>` + `<datalist>` of `existingNames(kind, …)`:
existing lectures plus free text for a new one, with no focus handling to reinvent. Its `aria-label`
reads "Attach material to".

`suggestItemName` turns the title's first integer into `<prefix> N`, plus at most one sub-session marker
glued to it as a decimal (a Latin letter, a Hebrew letter א–י, or a digit after a separator). Ambiguity
voids the marker rather than guessing; a title with no number falls back to the tree's next name.

A row's failure to _start_ flips its button to "Retry ✗" and toasts through `toastDownloadError`;
reconnect, passcode and a cancelled prompt don't toast, they steer the UI.
