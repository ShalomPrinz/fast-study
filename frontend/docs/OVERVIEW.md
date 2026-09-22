# Course overview

`/course/:course/overview` — per-course cross-lecture summaries ("extractors"), one branch each.

## Shape

`GET /overview/extractors` returns `{ slug, title, phases[] }`. `OVERVIEW_STEPS` maps each phase to its
output file (`{slug}.txt` / `.md` / `.pdf`) and label, and `stepsFor(phases)` picks one extractor's subset.
Everything derived (`generatedFiles`, `lastGeneratedFile`, `startedSlug`, `branchStatus`) goes through
`stepsFor`, so a new phase is a one-table change.

`CourseOverviewContext` is data-only: extractors, the `overview/` listing, meta and status, each behind
its own `useLatestRequest` and refreshed on every notify. `generate(names?, fromPhase?, skipExisting?)`
triggers and refreshes — refused or not — but never toasts; the caller toasts a `busy` `RunInitResult`
and the rejection a refused run throws.

## The view

`CourseView` shares the lecture view's frame: a `PageHeader` (the generating extractor, lecture and
recitation counts, how many are fully processed, `GenerateAllButton`) over one `.pipeline-card` of branch
rows. A running branch shows its phase and a clock counting up from `startedAt` where a lecture shows an
ETA — elapsed, since `timing.db` records no overview operation to estimate from. Expanding a branch shows
its phases as nodes over its files as monospace chips; only the branch's final PDF opens.

## Generate vs. continue vs. re-generate

The distinction is `skip_existing`, the feature's core rule:

- **Header button** — `skipExisting=true`, no filter: "Generate All", then "Continue Generating" once any
  output exists, then a disabled "All Generated". It only fills gaps, so it never overwrites and needs
  no confirm.
- **Per-extractor ↺** — `generate([slug])`, overwriting; the confirm lists every `{slug}.*` rebuilt.
- **Per-phase** — `generate([slug], phase)`: that phase and every later one. A completed phase node is
  itself the control; the confirm lists that suffix.

Explicit overwriting is always per-slug or per-phase and always behind a confirm.

## Per-slug gating

`GET /overview/status` returns an aggregate `running` plus per-slug `{ status, phase, startedAt }`,
because several extractors can run on one course at once. Only the header gates on the aggregate; each row
gates on its own slug, so one branch can be re-generated while another churns. `startedAt` is stamped once
per chain, so the clock counts the whole branch.

`branchStatus` is the single derivation of a row's `{ running, done, error, warning }`: `done` means the
extractor's _last_ file exists, and `warning` is the neutral channel — a skipped phase's reason, else a
`{slug}.pdf` that rendered despite LaTeX errors. Either way the row stays green, with a ⚠
`PdfWarningBadge` and no toast. A skip is not a failure, so `no_snippets_found`, `no_summaries_found` and
the overview's `missing_prerequisite` read through `serviceErrors.ts` onto that badge rather than an error
toast; `already_generated` is suppressed, since the row already reads as done and every "Generate All"
pass re-stamps it. Errors toast once per `(course, slug, failure)` through `useReportOnce`, pruned only
within the current course so switching back does not re-toast.

`overview/meta` gives per-slug lecture/recitation ranges and `generatedAt`, rendered by `formatRange`
("Lectures 2-9, Recitations 1-4") and a short date with the full timestamp on hover.
