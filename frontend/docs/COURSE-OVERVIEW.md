# Course overview mode

`/course/:course` — per-course cross-lecture summaries ("extractors"), one branch each.

## Shape

`GET /overview/extractors` returns `{ slug, title, phases[] }`. `OVERVIEW_STEPS` maps each phase to the
file it produces and its UI label: `extract → {slug}.txt`, `analyze → {slug}.md`, `topics → {slug}.md`,
`compile → {slug}.md`, `to_pdf → {slug}.pdf`. `stepsFor(phases)` picks one extractor's subset — pattern
extractors run extract/analyze/to_pdf, while the `topics` and `all-lectures` extractors produce only
`.md` + `.pdf` with no extract row.
Everything derived (`generatedFiles`, `lastGeneratedFile`, `startedSlug`, `branchStatus`) goes through
`stepsFor`, so adding a phase is a one-table change.

`CourseOverviewContext` is data-only: it owns the extractor list, `overview/` file listing, meta and status
fetches (each guarded by its own `useLatestRequest`), refreshes them on every SSE notify, and exposes
`generate(names?, fromPhase?, skipExisting?)` which triggers and refreshes but does **not** toast — the
calling component toasts the `RunInitResult`, keeping UI out of the context.

## The view

`CourseView` is a `PageHeader` band above one scrolling body, the same frame as the lecture view. The
header carries the course name as title, a metadata row (the extractor currently generating, lecture and
recitation counts from `CourseTreeContext`, and how many of them are fully processed), and
`GenerateAllButton` as the page's single primary action.

Below it the branches share **one** `.pipeline-card`, parted by rules inset to clear the status column.
Each branch row is a `StatusNode` mapped from `branchStatus()`, the expand caret, the extractor title over
its `formatRange · formatMonthDate` subtitle, and its actions — open-PDF and re-generate once done, a
`Generate` button before that. A running branch replaces those actions with the phase it is on plus a
clock counting up from `startedAt`, in accent monospace, where a lecture row would show its ETA — elapsed
rather than remaining, since `timing.db` records no overview operation to estimate against.

Expanding a branch opens its phase run underneath, inside the same card: every phase as a node — filled
green with a check once its file is on disk — joined by hairline connectors, over the branch's filenames
as monospace chips from `generatedFiles`.

## Generate vs. continue vs. re-generate

The distinction is `skip_existing`, and it is the feature's core rule:

- **Header button** — one call with `skipExisting=true` and no slug/phase filter. It reads "Generate All"
  when nothing exists and "Continue Generating" once `startedSlug` finds any output on disk. With every
  branch done there is nothing left to fill in, so it rests as a disabled "All Generated" and re-running a
  finished branch is the row's own ↺. Either way it only fills in missing phase outputs, so it can never
  overwrite and needs no warning modal.
- **Per-extractor ↺** — `generate([slug])` with no `skipExisting`, i.e. overwrite. Confirmed by a modal
  listing every `{slug}.*` that will be rebuilt.
- **Per-phase** — `generate([slug], phase)`: rebuild that phase and every later one, keeping earlier files.
  A completed phase in the expanded run is itself that control, so the run needs no buttons of its own; the
  modal lists exactly that suffix range.

Explicit overwriting is therefore always per-slug or per-phase and always behind a confirm.

## Per-slug gating

`GET /overview/status` returns an aggregate `running` plus per-slug `{ status, phase, startedAt }`, because multiple
overview runs can execute in parallel on one course. Only the header button gates on the aggregate; each
row's Generate/↺ gates on its own slug's `running` — a running branch shows no action at all — and the
phase named beside the spinner is that slug's own current `phase`. So one slug can be re-generated while
"Generate All" churns on another. `startedAt` is stamped once per chain, not per phase, so the elapsed
clock counts the whole branch; `ExtractorHeader` ticks it client-side and drops it when the branch stops.

`branchStatus(status, files, slug, phases)` is the single derivation of a row's
`{ running, done, error, warning }`: `done` means the _last_ file of that extractor's phase list exists,
and `warning` is that file's `warning` — a `{slug}.pdf` that rendered despite LaTeX errors but is usable.
A warning is not an error: the row still reads as done, its `StatusNode` stays green, and `ExtractorHeader`
shows the warning as a ⚠ `PdfWarningBadge` (message on hover) beside it, with no toast.

Only the branch row carries an open-in-new-tab button, for the extractor's final PDF; the file chips are
labels, and intermediate `.txt`/`.md` stay link-less. Extractor errors toast once per
`(course, slug, message)` via `useReportOnce`, pruned with a scope predicate limited to the current course —
otherwise switching away and back would re-toast errors already shown for other courses.

## Meta subtitle

`overview/meta` gives per-slug `{ lectures, recitations }` ranges and `generatedAt`. `formatRange` renders
"Lectures 2-9, Recitations 1-4", collapsing a single-item range to the singular and a null range to
"No Lectures". The date shows short ("10th July") with the full timestamp as a tooltip.
