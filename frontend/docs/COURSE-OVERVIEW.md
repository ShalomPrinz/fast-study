# Course overview mode

`/course/:course` — per-course cross-lecture summaries ("extractors"), one row each.

## Shape

`GET /overview/extractors` returns `{ slug, title, phases[] }`. `OVERVIEW_STEPS` maps each phase to the
file it produces and its UI label: `extract → {slug}.txt`, `analyze → {slug}.md`, `topics → {slug}.md`,
`to_pdf → {slug}.pdf`. `stepsFor(phases)` picks one extractor's subset — pattern extractors run
extract/analyze/to_pdf, while the `topics` extractor produces only `.md` + `.pdf` with no extract row.
Everything derived (`generatedFiles`, `lastGeneratedFile`, `startedSlug`, `branchStatus`) goes through
`stepsFor`, so adding a phase is a one-table change.

`CourseOverviewContext` is data-only: it owns the extractor list, `overview/` file listing, meta and status
fetches (each guarded by its own `useLatestRequest`), refreshes them on every SSE notify, and exposes
`generate(names?, fromPhase?, skipExisting?)` which triggers and refreshes but does **not** toast — the
calling component toasts the `RunInitResult`, keeping UI out of the context.

## Generate vs. continue vs. re-generate

The distinction is `skip_existing`, and it is the feature's core rule:

- **Header button** — one call with `skipExisting=true` and no slug/phase filter. It reads "Generate All"
  when nothing exists and "Continue Generating" once `startedSlug` finds any output on disk. Either way it
  only fills in missing phase outputs, so it can never overwrite and needs no warning modal.
- **Per-extractor ↺** — `generate([slug])` with no `skipExisting`, i.e. overwrite. Confirmed by a modal
  listing every `{slug}.*` that will be rebuilt.
- **Per-step ↺** — `generate([slug], phase)`: rebuild that phase and every later one, keeping earlier
  files. The modal lists exactly that suffix range.

Explicit overwriting is therefore always per-slug or per-step and always behind a confirm.

## Per-slug gating

`GET /overview/status` returns an aggregate `running` plus per-slug `{ status, phase }`, because multiple
overview runs can execute in parallel on one course. Only the header button gates on the aggregate; each
row's Generate/↺ gates on its own slug's `running`, and a step spinner lights only when that slug's current
`phase` matches the row. So one slug can be re-generated while "Generate All" churns on another.

`branchStatus(status, files, slug, phases)` is the single derivation of a row's
`{ running, done, error, warning }`: `done` means the _last_ file of that extractor's phase list exists,
and `warning` is that file's `warning` — a `{slug}.pdf` that rendered despite XeLaTeX errors but is usable.
A warning is not an error: the row still reads as done, and `ExtractorHeader` shows it as a ⚠
`PdfWarningBadge` (message on hover) next to `BranchIndicator`, with no toast.

Only the `.pdf` row and the header carry an open-in-new-tab button; intermediate `.txt`/`.md` stay
link-less. Extractor errors toast once per `(course, slug, message)` via `useReportOnce`, pruned with a
scope predicate limited to the current course — otherwise switching away and back would re-toast errors
already shown for other courses.

## Meta subtitle

`overview/meta` gives per-slug `{ lectures, recitations }` ranges and `generatedAt`. `formatRange` renders
"Lectures 2-9, Recitations 1-4", collapsing a single-item range to the singular and a null range to
"No Lectures". The date shows short ("10th July") with the full timestamp as a tooltip.
