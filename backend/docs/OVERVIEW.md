# Course overview

`course/` aggregates across a whole course's lectures. It mirrors `pipeline/` in shape (registry + workers + runner) but is keyed by `(course, slug)` instead of `(course, lecture, kind)`, so it needs its own state store rather than the per-lecture `_in_flight` map.

Outputs land in `{DATA_ROOT}/{course}/overview/` via the database service's overview endpoints.

## Extractors and phases

`course/overview.py` is a **pure registry** — it declares extractors and their phase chains and imports NO worker module, because every worker imports it back.

- `Phase` is a value-type enum: each member carries `.id` (wire/CSV/status string) and `.suffix` (on-disk output suffix). `EXTRACT`→`.txt`, `ANALYZE`/`TOPICS`→`.md`, `TO_PDF`→`.pdf`.
- `Extractor` declares `phases` as a ClassVar tuple — phase order is intrinsic to each extractor, there is **no global phase-order table**. `phases_from(from_phase)` yields the sub-chain to run; `output_file(phase)` is `f"{slug}{phase.suffix}"`.
- `PatternExtractor` (exam-hints, student-qa, pitfalls): EXTRACT → ANALYZE → TO_PDF. Its Gemini prompt is `assets/instructions/overview/{slug}.md`.
- `ImmediateExtractor` (topics): TOPICS → TO_PDF. It **collects, it doesn't analyze** — `collect.py` reads each `summary.md` directly and writes `topics.md`, then reuses the shared `to_pdf` phase. No LLM call.

An extractor only runs phases it declares, so a topics-only run never fetches transcripts and a pattern-only run never enters topics.

### Slug is the identity

Each extractor's kebab-case `slug` is the on-disk file stem, the status-map key, and the `?extractors=` CSV value. The human `title` appears only in the UI and the report header. Historically the display name doubled as the file stem, which desynced on-disk `exam-hints.txt` from a frontend lookup of `Exam Hints.txt`. Keep filenames slug-based across backend, database, and frontend.

## Phase workers

Each worker is pure work returning a `"done"`/`"skipped"` status dict, raising on failure. The runner owns the loop, status, notify, and failure isolation.

- `extract.py` — `fetch_sources` reads every transcript once; `run_extractor` writes `{slug}.txt`. Whisper transcripts are near-unbroken blobs, so windowing is by **sentence, never by line**. One window per matched sentence (`before`/`after` context), overlapping windows merged so clustered matches yield one snippet. Hebrew patterns are unanchored substrings so prefixed forms (ו/ה/ש/ב) match for free.
- `analyze.py` — reads `{slug}.txt`, sends it to Gemini with the extractor's prompt, writes `{slug}.md`. Missing `.txt` → skipped.
- `collect.py` — distills every `summary.md` into `topics.md` as **headers only** (H2 topics + nested H3 subtopics; built-in sections from `summarize.md` dropped). Entry headings are translated to Hebrew הרצאה/תרגול for display while sorting stays on the original English name so numeric order is unaffected. RLM marks keep Hebrew bullets RTL; pure-ASCII lines get none so they stay LTR.
- `to_pdf.py` — renders `{slug}.md` → `{slug}.pdf` through `pipeline/to_pdf.py`'s `convert_to_pdf`. Missing `.md` → skipped. Distinct from `pipeline/to_pdf.py`: this is the per-course phase worker, that is the per-lecture md→PDF primitive it reuses.

`ranges.py` snapshots a source set's lecture/recitation number range (first dotted-number token per name, natural-sorted min–max, no contiguity check).

## meta.json

`overview/meta.json` holds a per-slug snapshot of the source lecture/recitation ranges + `generated_at`. It is patched only when a slug's **extract** or **topics** phase produces output — never on skip, never on a later-phase re-run — so re-rendering a PDF leaves the snapshot describing the sources it was actually built from. The merge is server-side and atomic, so parallel per-slug PATCHes of the same course can't clobber each other.

## Run model

One `generate` trigger is one `OverviewRun`. The run owns its selection (slugs, `from_phase`, `skip_existing`) and the transcript `sources` — fetched ONCE, lazily on the first slug entering extract, memoized on the instance. It does **not** own status.

Module-level state in `course/runner.py`:
- `_locks[(course, slug)]` — persists across runs so same-slug triggers serialize.
- `_status[course][slug]` — the shared store runs write into; entry is `{"status", "phase"?, "message"?}`. It survives after a run finishes so `get_status` can read it. `running` is DERIVED (any entry running); `phase` is per-entry and is always the **string** `phase.id` — a `Phase` object must never reach the JSON-serialized store.

`execute` is slug-by-slug in declaration order. For each slug it does a non-blocking `lock.locked()` check then `async with lock`; an un-held `asyncio.Lock` acquires without yielding, so with no await in between the skip-on-collision is atomic.

**Locks are per-(course, slug), not per-course.** A run holds only the CURRENT slug's lock, so a separate trigger (the user regenerating one slug) runs a different slug of the same course fully in parallel — "let the user lead". Same slug + same course serialize; same slug in different courses run in parallel for free.

**Collision rule — first-come keeps it, other skips.** A run reaching a slug whose lock is already held by another run skips it and leaves its entry untouched; the lock-holder owns that entry. No waiting, no double work, no clobber. `try_run_generate` seeds `pending` synchronously only for slugs not already in flight, and returns `"busy"` iff every requested slug's lock is held.

Because a slug holds its lock across its whole phase chain, the UI shows one spinner per slug with no false "done" flicker between phases.

**Failure isolation.** A (slug, phase) failure marks that entry `error`, stops that slug's chain (no `to_pdf` on a failed analyze) and leaves the other slugs running. A slug already in `error` is left as-is by later phases, so the real failure survives to the final status instead of being masked as a downstream `skipped`.

`db_client.notify()` fires after each (slug, phase) work unit — done/skipped/error/kept — and once at run end.

## from_phase and skip_existing

`from_phase` makes the run START at that phase and continue through `to_pdf`. Earlier phases are skipped, so their `.txt`/`.md` files are kept (never deleted); a missing input just yields the phase's usual `skipped`. A `from_phase` an extractor doesn't declare falls back to that extractor's full chain. It is parsed at the HTTP boundary by `resolve_from_phase` so `main.py` stays thin route glue.

`skip_existing` (default `false`) is a **continue** mode:
- `false` — every participating phase overwrites its output. The per-slug ↺ re-generate flows rely on this.
- `true` — snapshots the overview dir once at run start and keeps any participant whose output file already exists, marking it `skipped` "already generated" without running its worker. A kept extractor stays a participant for later phases (a kept `.txt` still lets analyze run if `.md` is missing) and is never an error. A fully-done slug ends `skipped`; one whose missing tail regenerated ends `done`.
