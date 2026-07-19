# Downloads page

`/downloads` — connect the BIU account, keep each course's source URL, then discover and download
recordings into the same `DATA_ROOT` courses the pipeline uses. Talks to the auto-downloader service
(see `services.md` for its client and error signals).

## Auth

`AuthPill` probes `/auth/status` on mount. Connect pops a headed browser on the host for MFA and returns
immediately; the pill then waits for the user to click Done, which calls `/auth/complete` to persist the
storage state and re-probes.

A `ReconnectError` from anywhere on the page toasts a hint and bumps `reconnectKey`, which is the `key` on
`<AuthPill>` — remounting forces a fresh probe, since the pill's cached status predates the 401 and would
otherwise still read "connected".

## Discovery

One course is selected at a time; `listRecordings(sourceUrl)` returns a flat `Item[]` in page order. Items
are grouped into sections by `item.section` (the Moodle heading) in first-seen order, blank → "Other".

An item is either downloadable or `expandable` (a playlist). `SectionGroup` — not the row — owns the
expand state, the fetched children and the cache, because the bulk queue needs resolved children and the
"Download all" button needs to know whether every playlist is expanded. Children are cached on first
expand, so collapse/re-expand never refetches. Expandable rows render their children as recursive
`RecordingRow`s.

## Row name and kind: one source of truth

`RowEditsContext` (provided by `SectionGroup`, keyed by `item.ref`) stores **only overrides** —
`{ name?, kind? }`. `resolveRow` derives `{ kind, suggestion, value, name }` from an override plus the live
tree. Two consequences fall out of storing overrides rather than values:

- With no `name` override the displayed name keeps tracking the kind toggle; the first keystroke pins it.
- The green "already downloaded" row and the bulk queue's skip rule read the same resolved values, so they
  can never disagree.

Edits are never cleared, so they survive an SSE tree refresh, a collapse/re-expand, and a bulk run.

`isDownloaded(name, kind, courses, course)` is the single already-downloaded rule (exact name match in the
live tree). It drives both the green row and the queue's skip. A single row's Download on an existing name
opens an overwrite confirm first; the bulk run skips instead.

`suggestItemName` derives the name from the recording title: the first integer becomes `Lecture N` /
`Recitation N`, plus at most one sub-session marker glued to those digits (optionally after `.`/`-`/`_`) as
a decimal — a Latin letter (a=1…z=26), one of `אבגדהוזחטי` (א=1…י=10), or a bare digit when a separator is
present. Ambiguity voids the marker rather than guessing (whitespace, a second letter, a date tail), and a
title with no number at all falls back to the tree's next-number suggestion.

## Bulk download

"Download all" flattens the section into downloadable leaves — a playlist contributes its children, never
its own ref, which the backend rejects. It is disabled until every expandable is expanded, and never
auto-expands.

The queue runs **sequentially by design**: the auto-downloader drives one shared browser session, so
parallel requests would contend. It runs in continue mode (already-present items are skipped and tallied)
and reads both the course tree and the edits through refs, so a mid-run SSE refresh or a name typed while
it runs is honoured rather than the snapshot it started with.

Per-item outcomes: `ReconnectError` aborts the whole run and triggers the reconnect flow; a `PasscodeError`
pauses at that item and opens the prompt (submit saves the passcode and resumes by retrying the same item;
cancel abandons the rest of the queue); anything else marks it failed and continues. The header shows live
`Downloading n/N…` and ends with an `N downloaded, N failed, N already there` summary.

## Zoom passcode

`PasscodePrompt` is a masked-input modal mirroring `ConfirmModal`'s portal + Escape/overlay-cancel shape
(`ConfirmModal` can't host an input). It owns its input and scope state, and the parent unmounts it between
openings so a wrong-passcode re-prompt mounts fresh and empty. Scope defaults to course-wide; "just this
lecture" narrows it to the one recording.

In a single row, the passcode prompt and the overwrite confirm can never co-render — the confirm is already
dismissed by the time `download()` can hit the 409. The row keeps its spinner on across save → retry so it
doesn't flash off while the passcode is stored.
