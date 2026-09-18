# Bulk download

A section's "Download all", and the Zoom passcode gate it can park on.

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
delimiters, which holds because a course name cannot contain one and media is an enum.

`RunTarget` (`{ ref, name, kind, media, disposition }`) is a **cross-wire contract**: TypeScript in
`services/downloadServer.ts`, plain JS in the server's `runs.js`. Change one, change the other.
`disposition` is what the run decided — `pending` (not reached), `skipped`, `unsupported`,
`queue-failed`, or `queued`, the only one whose outcome is still open.

## Submit

The section flattens into downloadable leaves (a playlist contributes its children, never its own ref),
so "Download all" is disabled until every playlist is expanded and never auto-expands. Each leaf becomes a
`RunTarget` **at submit**: the row's resolved name and kind, plus the two verdicts only the page can give
because they read the live tree — `skipped` (`hasResource`, the rule that tints the row green) and
`unsupported` (a probe already condemned it; skipping it saves a probe round-trip per run). Everything
else goes as `pending`. A new run replaces the section's old one.

Two accepted costs of server ownership: a name typed while the queue runs is not picked up, and a row
downloaded by something else mid-queue is re-triggered rather than skipped.

The server triggers rows sequentially, since the auto-downloader drives one shared browser session; the
downloads themselves overlap. A 401 stops the run at `reconnect`, a 409 parks it `paused`, a 422 records
`unsupported`, anything else `queue-failed` and continues. The run's recorded verdicts also feed
`ResolvedMediaContext`, once per ref.

## Deriving the outcome

**Nothing about the outcome is stored.** `utils/runStatus.ts` derives each target on every render, in
order: `pending` stops there; a non-`queued` disposition wins; a `running` job → `in-flight`; the tree has
it → `downloaded`; an `error` job → `failed`; else `in-flight`. `summarize` counts the result into
`N downloaded, N failed, N unsupported, N already there`. Both are pure and unit-tested; the run, the
tree and the jobs are all live reflections a remount simply re-reads.

- A running job outranks the tree because a zoom share lands `name.1` while `name.2` is still going.
- A target's jobs are `ref` **and** name-scoped (`name`, `name.1`, `name.2`): jobs are keyed by lecture
  name, so a row renamed between runs leaves old jobs under the same ref.
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

The header shows `Downloading {at}/{total}…` while `running`/`paused`, else `Downloading n more…` for
targets with a running job, else the summary. The bulk run never toasts per item. A run ending at
`reconnect` raises the session-expired hint from the provider, once per run id, with a `primed` flag so a
run already aborted before load is history.

## Zoom passcode

`PasscodePrompt` mirrors `ConfirmModal`'s portal and Escape/overlay cancel (`ConfirmModal` cannot host an
input); the parent unmounts it between openings so a wrong-passcode re-prompt starts empty. Scope defaults
to course-wide.

A run's pause is a **rendered status, not held state**: the prompt renders whenever the reflected run
reads `paused`, so a gate hit on another page or before a reload still asks, and the server holds the
queue meanwhile. Submit saves the passcode through auto, then `POST /runs/:id/resume` retries that row; a
failed save resumes with `{skip:true}`. Cancel abandons the rest of the queue. A double submit is the
server's to reject (409), not a race the component guards.

`PausedRunsBanner`, inside the open course panel, lists every paused run. An entry is a button only when
its section is in the open course on **another** segment (it calls `ModeToggle`'s `selectMode`); anything
else has nowhere to jump. `usePausedRuns` caches its array **keyed by run id only** — a consumer reading
anything beyond `id`/`sectionId`/`course` must widen that comparison first.

In a single row the passcode prompt and the overwrite confirm never co-render; submit saves and resumes
the intent that hit the gate (`passcodeResume`) in one render so no spinner flashes off.
