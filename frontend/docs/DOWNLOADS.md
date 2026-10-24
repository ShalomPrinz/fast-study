# Downloads page

`/downloads` — connect the university account (the site chosen in [SETTINGS.md](SETTINGS.md)), keep each
course's source URL, then discover and download recordings into the same `DATA_ROOT` courses the pipeline uses. Discovery and auth go to the
auto-downloader (:3053), downloads and bulk runs to the downloader server (:3052); their clients and
error classes are in [SERVICES.md](SERVICES.md). A download's progress is [JOBS.md](JOBS.md), a
section's "Download all" is [BULK.md](BULK.md).

## Layout

Three tabs, University, Extension and Manual (`DownloadsTabs`, the light segmented switch at full width), ride in the
`PageHeader`'s secondary row, so title and tabs stay frozen while `.page-body` scrolls; the body is keyed
by tab, so each opens at its top. The header meta is per tab: University the account chip and the count
of courses with a source, Extension the setup time, Manual a one-line description, and "Loading your data…"
while no tab is chosen; all share one grid cell with the rest hidden (plus a hidden button-height
placeholder for the chip still loading), so the header's height and the tab row never move. Extension is the folder downloads and the guide
([EXTENSION.md](EXTENSION.md)), Manual is `ManualDownload` (below).

`useDownloadsTab` picks the tab through the pure `defaultTab`: a valid stored choice
(`fastStudyDownloadsTab`, written only on a click), else University when the account is connected and
Extension when signed out or the account read failed. Only with no valid stored choice does the page wait
for the first account answer (`AuthStatusContext`'s `settled`: a pushed frame, or `AccountStatus`'s
one-shot read finishing or failing — it is mounted on every tab, so that read always runs); meanwhile the
body is a spinner and no tab is selected. That default is then fixed for the app session, so a later
sign-out or a return to the page never moves it.

The University tab is the unconfigured-site nudge, then one `CourseSourceRow` per active course plus `AddCourseRow` (alone with no courses; under a `.source-list-failed` danger note when
`courseLoadNotice` says the load failed, still usable since a create reports its own failure), then — once a course is loaded — the `.recordings-panel`. The 880px measure
fits a recording's second line: kind toggle, name input and action side by side.

A source row is three grid tracks with the side ones equal, so every row's URL sits at the midpoint and
lines up down the list; only the action track is floored at its content, so a narrow window costs the
URL its centring rather than sliding the buttons over it. `ModeToggle` emits its cards and body as
siblings, so the panel is a three-column grid: the cards centred in row 1 between two close-button-wide
tracks, the close button in the end one, the body spanning all three beneath; each card's floor yields to
a third of the middle track, so the cards never run under the close button.

A recording is a two-line card — what it is, then where it is going (`Save as`, kind toggle, name,
action). States are tints: accent while downloading, `--ok` once the target is in the course (an
`In course` chip plus an icon-only `Download again`, always visible so it is keyboard- and
touch-reachable, routed into the overwrite confirm), faded for `unsupported`.

## Course sources

A course's source is the course page URL (`…/course/view.php?id=N`) — what Load recordings and auto's
`/list` read. `CoursePicker` sets it: the pencil, "+ add source URL" and `AddCourseRow`'s "+ Add course from
Moodle" open it under their row. It fetches auto's `GET /courses?lang=<UI locale>` once per open
(`useEnrolledCourses`, through the Moodle lock with `{ wait: true }`, one request even across StrictMode's
remount — the site walls a second call seconds after the first) and lists current courses, then the `past`
ones (hidden or ended) behind "Show past courses". Each row is the name in that language plus the course
`code`, when Moodle has one, as a muted `.chip` before it — picker-only, never prefilled or saved. Each list is a
grid whose rows are subgrids, so names align in a column after its widest chip; a code over `CODE_COLUMN_CAP` (16 chars, `codeOverCap`)
sets no column width and its name just follows its chip. Names stay
in the open-time language: a mounted picker holds the locale (`useLocaleHold`, a module store, no provider),
which disables the sidebar's `LanguageSwitcher` under a "close the course list" hint. `pickerView` opens it straight on the paste input when the account is known to be
not connected (with the Load-recordings hint), when the list is `available: false` (the site closes it to
the Moodle app) or empty, or after a failed fetch, which first gets the page's usual word: the reconnect
hint, the block toast, or the service's reason.

A picked course saves its `url` unchecked — Moodle built it. A pasted one is checked first with `POST
/courses/check` (`useCourseUrlCheck`); any refusal — not a course page, off the site, not accessible,
reconnect, blocked, busy — shows its reason under the input (`CourseCheckFailure`, `.course-check-failure`)
with "Save anyway" (saves unchecked) and "Edit". An empty paste saves with no check: it clears the source.
`needsCheck` is that one rule. In the add form, a picked course prefills the name (editable) and fixes the
URL (`addFormDraft`); a typed URL is checked on Create the same way. A URL saved anyway that `/list` then
refuses reads as the service's reason on Load recordings — `invalid_request` with `field: courseUrl` has its
own branch in the catalog row, so it never reads as the bare generic line.

## Manual download

The Manual tab (`ManualDownload`), always open: paste a video link, type a course
(the active ones are suggestions; any other name is created first, an archived one answers `name_taken`),
kind and name, and `POST /download-url` queues it. auto decides the route: a link on the configured
Moodle site's origin is proxied through auto under the Moodle lock (below), any other runs yt-dlp; both
fetch with no session or cookies, so the link must open without signing in. The name is `suggestName`'s next free one, also skipping names
this session's manual downloads already claimed (`suggestManualName`), since an in-flight one is not in
the tree yet; replacing a stored video confirms first. The link is never cleared for the user, whether
the download starts, lands or fails. Its jobs are [JOBS.md](JOBS.md) §Manual jobs.
The whole draft (link, course, kind, name) is a module store, so it survives leaving the page but not an app restart.
The course field is `CourseCombobox`, an in-app ARIA combobox rather than a `<datalist>`, whose Chromium popup
can't be styled or made to list everything: unedited since it opened it lists every active course, after an edit
only those containing the text (`courseOptions`); arrows move, Enter or a click picks, Escape closes.
The form is a two-column grid in reading order: link and course a full row each, kind beside name, then
the wide Download button centred; its text and controls are one type step above the page's other forms.

## Auth

`AuthStatusProvider` sits in `Layout` so the header chip and every course row read one state: the
auto-downloader's `GET /auth/events` stream (`subscribeAuth`, the current state on subscribe and on every
change), opened on mount. It never toasts, so a route with no account control never reports the service
as down. The stream cannot say "no university configured" (it reads as idle), so `AccountStatus` also
asks `/auth/status` once per mount (`refresh`), and the provider adds `unconfigured` while the pushed
phase is idle. `status: null` is "unknown".

A frame's `zoomCaptcha` (absent reads false) is a zoom download waiting on a captcha in the on-screen
Chrome window, and `challenge.captcha` the university site's challenge window doing the same.
`CaptchaBanner`, in `Layout` atop the content column so it follows every route without covering the
sidebar, shows while either is true (`captchaWait`, which names the site when both are) and hides on the
frame that clears them. While shown it publishes its measured height as `--captcha-banner-h` on `:root`,
which `toaster.css` adds as a top margin to top toast containers so a toast never covers it. Its "Show captcha window" button calls `POST /window/show` (`showWindow`) to raise
a window the OS left behind the user's work; a 409 `no_window_waiting` toasts like any coded failure. If
auto dies mid-wait, the banner stays until the stream reconnects and its first frame reads false.

The capture's other end is `captchaSolved: true` (absent otherwise, never false), never the stream: it
means this very item waited on that captcha and its player then appeared, so a queued download is never
mistaken for the one that waited. A row download reads it off its `/download-item` answer; a section run
carries it on the target (`run.targets[i]`, never the run), read off the `/runs` resync. Either way
`toastCaptchaSolved` shows a short success toast and never touches the held one, whose lifetime is
the stream's flag alone: an earlier item's late answer must not close the next item's wait. Every resync
repeats a target's flag, so `createCaptchaCatches` toasts once per run id + target index, and its first
snapshot per provider mount only seeds: a reload never replays a catch that already happened.

The site's captcha needs no such answer: a routed Moodle call that meets it waits in auto for the solve
and carries on, so the row stays pending (its `/download-item` simply takes longer) and every other Moodle
button reads busy, since the wait holds the lock. The solve's toast is pushed instead: `challenge.solved`
counts auto's solves, and `createSiteCaptchaSolves` (fed by `AuthStatusProvider`, toasting through
`Layout`) toasts once per rise: "Captcha solved. Continuing." when the last captcha frame before it had
`moodleBusy` (a call already waiting inside the captcha window), else "Captcha solved." (a call merely queued behind it included) The first frame after each (re)connect only
seeds, and a lower count (auto restarted) seeds afresh. A solve the unverified account's panel already
announces ("The captcha is solved. Finishing the connection…") does not toast while an `AccountStatus` is
mounted (`useAccountPanelShown`, `siteSolveToasts`); on any other page it toasts. A captcha left unsolved for 10 minutes fails the
call with `site_captcha_timeout`, toasted like any coded failure.

Connect only posts `/auth/connect`, which returns at once: the service runs the whole login itself and
pushes `phase: 'pending'` from window open through verification, so the chip reads "finish login in the
browser window" (no button) from the stream, and a reload mid-login shows it again from the subscribe frame.
Success arrives as `connected`. A failed attempt arrives as the state's `error`; `loginToast` toasts it
once, on the frame that ends a run this tab watched (previous frame `pending`, this one not), so a replayed
state after a resubscribe or reload never re-toasts the leftover error. Disconnect sits behind a
`ConfirmModal`, since getting the token back is another MFA round-trip. Connect sits behind one too while the frame's
`storedSite` (renamed `tokenSite` past `subscribeAuth`, so it never reads as the configured site) names
another university's token, which that Connect deletes; `foreignSiteName` names it by its preset, else its host. Both settings screens reuse
`AccountStatus` with the `--danger` tone retoned ([SETTINGS.md](SETTINGS.md)) — only this page is blocked
by a missing session.

A `ReconnectError` anywhere toasts a hint and bumps `reconnectKey`, the `key` on `<AccountStatus>`:
remounting re-runs the probe, since the cached status predates the 401. That is why the probe lives in
the component, not the never-remounting provider. A `BlockedError` (the site's bot protection answering
a burst with a captcha) is deliberately not that path: it says nothing about the token, so it toasts
`toastBlocked(challengeWindow)` and leaves the chip alone. `challengeWindow` (`challengeWindowOf`) is
`'captcha'` (solve it in the window, then repeat — only the site probe, or a call that already waited
out two solves, still answers it), `'ready'` (just repeat), `false` (no browser could open:
wait) or `null` (a path the window can't carry: the generic wait). The wording is `site_blocked`'s catalog
row, a `select` on that param, so a job failure carrying it reads the same; `blockedToastKind` makes the two
instructions (`'captcha'`, `'ready'`) info toasts and the waits errors, wherever a block is toasted. Nothing retries or resumes by
itself, a section run included.

**Unverified is its own state.** `unverified: true` (a token kept after a bot challenge blocked the
post-login check) is neither connected nor not: `accountView` (`utils/accountView.ts`, the one decision of
chip and panel) gives it a `data-account="unverified"` warn chip ("waiting for you to solve the captcha"),
the button that finishes a login (it calls `/auth/complete`, which re-verifies the stored token, reopening
the window if the wall is still up) and Disconnect, and an inline `.account-panel`. The panel comes from the
state's `site_blocked` `challengeWindow` corrected by the pushed
`challenge: { open, captcha }`: a captcha on screen is `window` (button "I solved the captcha", though auto
verifies by itself once it is solved); a recorded captcha gone from a still-open window that showed it (`captchaSeen`,
folded over the frames, since a reopening window shows none yet either) is `solved` (auto is verifying, so
no button); gone from a closed window is `closed` (closed unsolved — never read as passed;
button "Open the captcha again"); a recorded `'ready'` (a check walled inside the window, which reloaded
onto the site) is `ready` (no captcha, button "Try again"); `false` is `own-browser` and nothing known is `unknown` (both "I
confirmed, try again"). A refused
`/auth/complete` toasts from its own rejection (`BlockedError`, `UnsupportedError`; a 401 `reconnect` means
the token is gone, so "sign in again"), and the outcome also arrives on the stream. The same component
serves the first-run wall ([SETTINGS.md](SETTINGS.md)).

`/auth/status`'s 409 `moodle_site_not_configured` is an answer, not a failure: `fetchAuthStatus` maps it to
`unconfigured`: the chip reads "no university chosen" with no Connect, the page leads with a nudge linking to
Settings, and Load recordings is disabled with a tooltip saying why — the init wall lets a user in without one. A login the site's post-login
check refuses answers with 422 (a rejected `/auth/complete`, or the state's error) `moodle_site_unsupported`, which `loginFailure` toasts in
its `reason`'s sentence.

`Load recordings` disables only on `connected: false`; unknown leaves it enabled, since guessing
"disconnected" from an unanswered probe would lock a working session out.

## The Moodle lock

auto talks to Moodle one request at a time and holds one global lock for each request plus 3 s after it
(and for a whole login, or while a challenge window is open) — `downloader/auto/docs/GATE.md`. Every
frontend call that can reach Moodle goes through `withMoodleLock(fn)` (`useWithMoodleLock`, from
`MoodleLockProvider`, which `AuthStatusProvider` renders): Connect, Complete, Load recordings,
"Download all", the settings site probe, and a row's Download, Download again and clip retry — but only on
a row whose `moodle` flag auto set (`rowLocked`); a Zoom, YouTube or Drive row calls directly and stays
enabled. The flag is the only source for a row: the frontend infers nothing from kind or URL, and a wrong
`false` is the quiet 429 below. The manual form's Download and Retry have no flag, so they apply auto's own
test — the link's origin equals the configured `moodleSite`'s (`onMoodleSite`, in `useManualStart`); a
YouTube link stays enabled through a long section run. A playlist's expand is not gated — its children are YouTube. The
store is `utils/moodleLock.ts`: its state is the pushed `moodleBusy` (every `/auth/events` frame) OR a
call of this tab in flight — counted on call, so a double click can't send two before the frame lands.
There is no local timer; the push says when the cooldown ends.

While `moodleLocked(state)` holds, every one of those buttons is disabled with the `moodleBusyMessage()` tooltip.
A row's overwrite confirm (Yes) and passcode modal (Submit) replay that row's download, so they follow the
same `rowLocked` rule and re-enable in place once the push clears; Cancel never locks.
The exemption is an open challenge window (`accountView`'s `panel === 'window'`): it holds the lock itself
and is waiting for Complete, so Complete and Connect stay enabled unless this tab's own call is in flight.
A button that still races the push gets 429 `moodle_busy` → `MoodleBusyError`, which every caller swallows:
no toast, no "Retry ✗", no row error. A call nobody pressed passes `{ wait: true }`: it waits for the lock
to free and asks again after a 429 — woken by any frame, since a reconnected stream repeats `false`
rather than flipping — so it never fails on busy; its `stale()` drops it before it is sent once its caller
moved on (a superseded site probe). A section run and a job's re-resolve queue
inside `server/` instead, so they never see the 429.

## The page session

`DownloadsSessionProvider` (in `Layout`) holds everything the page accumulates — `selected`/`pending`,
`items`, row edits, `reconnectKey`, plus `discover` and `close` — so a trip to a lecture and back
finds the same course and typed names, and a discovery in flight when the user leaves still lands. State
and an identity-stable actions bag are separate contexts; the memoized rows bail out on the setters'
identity.

`discover` sets `pending` (the row's `Loading…`) and promotes the course to `selected` only once
`listRecordings` resolves, so every failure leaves the page as it was — the open course included — and
toasts once: the reconnect hint, `blockedMessage(challengeWindow)`, the client's connection toast, the service's reason for a
coded refusal, or a generic "couldn't load" line. Each discovery takes a ticket; `close` or
another course bumps it, so an answer the user walked away from writes nothing. The reconnect hint is
the exception — an expired session is true whichever discovery found it.

Saving a new source URL on the course `selected` or `pending` closes the panel and, unless the URL was
cleared, rediscovers from the new one (`sourceChangeAction`, called from `CourseSourceRow`) with
`{ wait: true }`, since nobody pressed it; a failed reload leaves the panel closed with discovery's usual toast. Other courses' edits touch nothing.

## Discovery

`listRecordings(sourceUrl)` returns a flat `Item[]` in page order. `media` is `'video'` (lands as
`video.mp4`), `'material'` (a Moodle PDF, appended as the next `material.N.pdf`) or `'unknown'` (a
Google Drive row — no filename, so only a download-time probe can tell). The destination is derived
server-side from the opaque `ref`; the frontend branches its own affordances on `media` and never sends
it.

A `ModeToggle` (`mode-toggle--cards`) splits the three segments, each an icon card with its count — Unknown
only while it holds a row (`showsMediaSegment`). `MediaNote` captions the chosen card: `mediaNote(media,
autoRun)` picks the hint, and only the video side's follows AUTO_RUN and links to Settings, since only a
video download starts a pipeline step. Then `groupSections(items, media)` filters
by media _before_ grouping by Moodle heading (first-seen order, blank → "Other"), so a section with
nothing on the active side does not render and "Download all" covers one media only.

A row auto stamps `likelyRecording: false` (a `url` module with no recording keyword) moves into a
synthetic **Other links** bucket, placed last — this keeps stray links out of the lecture sections, and
on Unknown keeps "Download all" from serially probing each one. The bucket is marked `synthetic`, never
recognised by title, and has **no run identity**: `section.id = null`, no "Download all", out of every
bulk queue. Giving it an id would collide with a real heading of the same name in the server's run map.
`useSectionRun(null)` reads as "no run".

A playlist row is `expandable` and renders as a collapsible group (`PlaylistGroup`, with its own
"Download all" — [BULK.md](BULK.md) §Playlists). Expansion state and fetched children live in a module store
(`RowExpansionsContext.ts`), not the row: the section's bulk queue needs resolved children, its "Download all" needs to
know every playlist is expanded, and the state must survive a segment switch. Each playlist subscribes to its
own ref; children are cached on first expand; the session's `clear()` calls `clearExpansions()`.

Each section header (`GroupHeader`, shared with playlists) has a caret + title toggle whose hit area stretches over the whole line (only
"Download all" sits above it); it hides (never unmounts) everything below it — the rows and the passcode
prompt hold in-flight state. Collapsed keys live in
a sibling module store (`SectionCollapseContext.ts`, keyed `section.id`, or `course:media` for the synthetic pile, open by
default), so they survive a segment switch; `clear()` resets it, and a paused run re-opens its section so
the passcode prompt can't stay hidden.

## Unknown rows

An `unknown` row carries a chip — `?`, then `Video` / `Material` / `Unsupported` — and **never changes
segment** once resolved. `resolvedMedia` comes from auto's session probe cache on listing, or from a
download: `POST /download-item`'s `media` and a 422 `UnsupportedError` are both verdicts, reported
through the dispatch-only `ResolvedMediaContext` and stamped onto the item. It sits above the segments
because a segment switch unmounts every row. A row resolved to `material` gets the whole material
affordance; an `unsupported` one (a dead link included) fades with Download disabled, never offering
Retry (`rowAction`).

## Row name and kind

`RowEditsContext` stores **only overrides** (`{ name?, kind? }` per `ref`); `resolveRow` derives the
displayed values from the override plus the live tree. In a lectures-only course it ignores the kind
override and auto's keyword guess and hides the toggle: the name keeps the guess's prefix (a `תרגול 5`
recording never takes `Lecture 5`'s name) and the kind follows the name — `lecture`, unless it is an
existing recitation's (`lecturesOnlyKind`), so one downloaded before the switch still reads as on disk.
The Manual tab does the same, reading a course the tree lacks yet as lectures-only under `lectures_all`
(`useNewCoursesLecturesOnly`, the database's live `GET /course_structure`). So an untouched name keeps tracking the kind
toggle, and the green row and the bulk skip read the same resolved values. Edits persist for the whole
course (SSE refresh, segment switch, navigation) and reset on another course or close, so refs never
collide. State and dispatch are split: only `SectionGroup` and `ChildRows` subscribe to the map, and the
memoized `RecordingRow` takes its slice as a prop, so a keystroke re-renders one row. A bulk submit reads
the map at click time through the dispatch bag's identity-stable `read()`, so a playlist header never subscribes.

**A download locks its row's name.** An untitled row's suggestion is the tree's next free name, so once
its lecture lands the suggestion would move on and the row would lose its bars and green state. A
download the server accepts — the row's own (`useRecordingDownload`, not a clip retry) or each `pending`
target of "Download all" (`startAndLock`) — records `{ course, name, kind }` per `ref`; a refused one
locks nothing, so it never claims a name another row then fills. `resolveRow` uses the lock in place of the
suggestion while course and kind still match; a typed or server-renamed `edit.name` still wins. Other rows
keep following the suggestion. The locks live in `DownloadsView` (`useRowLocks`), not the session, so
leaving the page drops them and every name is worked out afresh on return.

**The server owns the on-disk spelling.** Both submit endpoints canonicalize names (`:` is illegal on
NTFS) and answer `renames`; `applyRenames` writes them back through `setName` with one toast per
submission. The stored name is then the on-disk one, which is what lets every "already there" check
match — no client-side sanitizing, which would only hide the desync.

`hasResource(item, name, kind, courses, course)` is the single already-downloaded rule: the named node
holds `video.mp4` for a video (`holdsVideo`, a removed one included, so bulk skips the lecture and a
manual re-download still confirms), or for a material a material whose `source` equals the row's `ref`
(equality only; a source-less manual or legacy PDF matches no row), so several materials share one
node. It also decides the bulk skip and `targetLanded`. An unprobed `unknown` or an `unsupported` row
is always false rather than ever showing a wrong "downloaded". The overwrite guard is the separate
`overwritesVideo`: any non-material, non-unsupported row — an unprobed `unknown` included, since it may be a
video and a video PUT wipes the transcript and summary — confirms when its target holds `video.mp4` in the tree — never because of a job;
`splitSiblings` also catches `${name}.1`/`.2` (a zoom row splits into those) with a "might
overwrite" confirm. **A material row never confirms** — it appends, and shows the target's material
count instead.

A row whose target lecture — or, for a video row, a `splitSiblings` name — the pipeline is running or
queued on is disabled with a tooltip, and `useRecordingDownload` re-checks at start (a confirm replays an
older render): a video PUT would wipe the folder under a run that keeps writing the old video's outputs,
and a material would race the summary. "Download all" skips such targets instead (see `BULK.md`).

## Material rows and name suggestion

A material row's destination is a native `<input list>` + `<datalist>` of `existingNames(kind, …)`:
existing lectures plus free text for a new one, with no focus handling to reinvent. Its `aria-label`
reads "Attach material to".

`suggestItemName` turns the title's first integer into `<prefix> N`, plus at most one sub-session marker
glued to it as a decimal (a Latin letter, a Hebrew letter א–י, or a digit after a separator). Ambiguity
voids the marker rather than guessing. A title with no number takes the number from its Moodle section
heading, only when a lecture/recitation keyword precedes it ("הרצאה 3א: …", sub-marker included); date
ranges and "שבוע 3" don't count, a range heading ("הרצאות 3-4") takes its first number, and numberless items of one section share the name. Otherwise it falls
back to the tree's next name.

A row's failure to _start_ flips its button to "Retry ✗" and toasts through `toastDownloadError`;
reconnect, passcode and a cancelled prompt don't toast, they steer the UI. A coded failure — here, in a
section run and in a playlist's in-row `expandErrorText` — reads in the service's words; only a codeless
one gets the generic line.
