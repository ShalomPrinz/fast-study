# Bulk download

A section's or a playlist's "Download all", and the Zoom passcode gate it can park on.

## The page starts a run and then only reflects it

"Download all" is one `POST /download-section`; the queue, its progress, each row's disposition and the
passcode pause are the downloader server's (`downloader/server/docs/RUNS.md`). So a run survives a
segment switch, a closed panel, a reload and a closed tab — a client-side queue dies with the tab, along
with a prompt the user was one keystroke from answering.

`SectionRunsProvider` (in `Layout`) is the reflection, built like [JOBS.md](JOBS.md): a contentless
`run:change` ping, a sequenced `GET /runs` refetch (an older reply after the terminal `done` would strand
the section on "Downloading…"), and a module store keyed by `sectionId`, read per section by
`useSectionRun(id)`. The key is `${course}:${media}:${title}` — both qualifiers matter, since one heading
usually holds a video and its slides and a run outlives the course it started in. `sectionId` /
`parseSectionId` (`utils/sections.ts`) build and parse it; parsing takes the first two colons as
delimiters, which holds because a course name cannot contain one and media is an enum. A playlist's run
key is `playlistRunId(sectionKey, ref)` — the section key, U+001F, the playlist's ref — which no
Moodle heading or ref contains, so it never collides with a section key and `runSectionKey` splits it back.

`RunTarget` (`{ ref, name, kind, media, disposition }`) is a **cross-wire contract**: TypeScript in
`services/downloadServer.ts`, plain JS in the server's `runs.js`. Change one, change the other.
`disposition` is what the run decided — `pending` (not reached), `skipped`, `unsupported`,
`queue-failed`, or `queued`, the only one whose outcome is still open.

## Submit

The section flattens into downloadable leaves (a playlist contributes its children, never its own ref),
so "Download all" is disabled until every playlist is expanded and never auto-expands. Its count and the
header's are those leaves (`leafCount`; an unexpanded playlist counts as one until its children are known). Each leaf becomes a
`RunTarget` **at submit**: the row's resolved name and kind, plus the two verdicts only the page can give
because they read the live tree — `skipped` (`hasResource`, the rule that tints the row green, or
`overwritesVideo`, so an unprobed `unknown` never replaces a stored video — a run has no confirm — or the
pipeline running or queued on the target or a video's split sibling, which a single row refuses; the
header counts it among "already there") and
`unsupported` (a probe already condemned it; skipping it saves a probe round-trip per run). Everything
else goes as `pending`. A submit where two `pending` non-material targets share a kind and name
(`collidingNames`) is refused with a toast: they would race into one lecture and the later PUT would
replace the earlier. A new run replaces the section's old one.

Two accepted costs of server ownership: a name typed while the queue runs is not picked up, and a row
downloaded by something else mid-queue is re-triggered rather than skipped.

The server triggers rows sequentially, since the auto-downloader drives one shared browser session; the
downloads themselves overlap. A 401 stops the run at `reconnect`, a 409 parks it `paused`, a 422 records
`unsupported`, anything else `queue-failed` and continues. The run's recorded verdicts also feed
`ResolvedMediaContext`, once per ref.

## Playlists

`SectionGroup` renders an `expandable` row as `PlaylistGroup`: the section's own `GroupHeader` (caret,
bold title, whole-line toggle, hover tint) over its children, indented with a side rule and hidden, not
unmounted, when collapsed. The first click fetches the children (`expandItem`, spinner in the caret);
until then the header shows no count and its "Download all" is disabled with "Expand this playlist
first", as a section's waits for every playlist instead of auto-expanding. Its run is the section's machinery
(`useBulkRun`, `BulkRunControls`, `BulkRunNotes`) over the children alone, under the playlist's run key.
The children are YouTube, so the playlist run waits out the Moodle lock only when auto flagged a child
`moodle`, as a single row does. A playlist run never parks at a passcode gate — its children are YouTube
and only a Zoom share asks for one — so `BulkRunNotes` renders the prompt for a section run only, and the
banner only ever lists section runs.

The section's "Download all" still queues every playlist's children. Two runs over one row would download it
twice, so each waits out the other (`bulkGate`'s `other-run`): a playlist's button is disabled while its
section's run is busy, and a section's while any playlist run inside it is (`usePlaylistRuns`, `runBusy`) —
busy meaning queue walking or a download it started still running.

## Deriving the outcome

**Nothing about the outcome is stored.** `utils/runStatus.ts` derives each target on every render, in
order: `pending` stops there; a non-`queued` disposition wins; a `running` job → `in-flight`; the tree has
it → `downloaded`; an `error` job → `failed`; a `cancelled` job → `cancelled`; else `in-flight`.
`summarize` counts the result into `N downloaded, N failed, N cancelled, N unsupported, N already there`. Both are pure and unit-tested; the run, the
tree and the jobs are all live reflections a remount simply re-reads.

- A running job outranks the tree because a zoom share lands `name.1` while `name.2` is still going.
- A target's jobs are course-, `ref`-, name- and kind-scoped (`name`, `name.1`, `name.2`, via `jobsForTarget`,
  as a single row's are): jobs are keyed by lecture name, so a row renamed between runs leaves old jobs under the same ref.
- The tree owns "downloaded" (`targetLanded`, which asks `hasResource` about all three names); an
  `error` job is never time-evicted and is superseded by a retry, so it proves the _latest_ attempt
  failed. Absence of evidence reads as "still going", right for the window before `/jobs` catches up.

**Busy is positive evidence, never the fallback.** "Still going" never expires, so `runningCount` counts
only targets with a `running` job — the same rule a single row's button uses. A running job cannot outlive
the work, so the section always frees its button.

Once the run has stopped, two warning lines cover what the summary cannot:

- **Unverified** (`unverifiedCount`): `queued`, no jobs, not in the tree — the lecture was deleted or
  renamed, the name desynced, or the tree fetch failed (it publishes an empty tree). No action, since
  none is fixable from here.
- **Never reached** (`notStartedCount`): `pending` targets prove the run stopped short. Without it a 401
  at row 3 of 20 reads "2 downloaded". Its action follows the status: reconnect, or run again.

Two limits of deriving with no memory: for one SSE round-trip after a retry the superseded `error` job
flickers the target through `failed`; and a half-failed zoom pair reads `downloaded`, since `.1` on disk
satisfies `targetLanded` — per-half accounting would need job ids from the POST.

`bulkRunState` derives the header's facts from the run, and `bulkGate` decides the button: expand first,
then its own busy run, then the other run, then the Moodle lock. The header shows `Downloading {at}/{total}…` while `running`/`paused`, else `Downloading n more…` for
targets with a running job, else the summary. The bulk run never toasts per item. A run ending at
`reconnect` raises the session-expired hint from the provider, once per run id, with a `primed` flag so a
run already aborted before load is history.

## Zoom passcode

`PasscodePrompt` mirrors `ConfirmModal`'s portal and Escape/overlay cancel (`ConfirmModal` cannot host an
input); `onDismiss` overrides what Escape and an overlay click do. The parent unmounts it between openings
so a wrong-passcode re-prompt starts empty. Scope defaults to course-wide.

A run's pause is a **rendered status, not held state**: the prompt renders whenever the reflected run
reads `paused`, so a gate hit on another page or before a reload still asks, and the server holds the
queue meanwhile. Submit saves the passcode through auto, then `POST /runs/:id/resume` retries that row; a
failed save resumes with `{skip:true}`. Cancel abandons the rest of the queue and stops the downloads the
run already started. Escape and an overlay click only close the prompt — the run stays parked, since a
stray key must not kill running downloads; `SectionRunsContext` holds that closed state per run id and
drops it once the run leaves its gate. A double submit is the server's to reject (409), not a race the
component guards.

`PausedRunsBanner`, inside the open course panel, lists every paused run. An entry is a button only when
its section is in the open course: it reopens a closed prompt, expands the section and, on another
segment, calls `ModeToggle`'s `selectMode`; anything else has nowhere to go. `usePausedRuns` caches its array **keyed by run id only** — a consumer reading
anything beyond `id`/`sectionId`/`course` must widen that comparison first.

In a single row the passcode prompt and the overwrite confirm never co-render; submit saves and resumes
the intent that hit the gate (`passcodeResume`) in one render so no spinner flashes off.
