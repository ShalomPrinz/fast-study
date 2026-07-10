# CLAUDE.md — backend

Guidance for Claude Code when working inside `backend/`.

## What this is

FastAPI app exposing the lecture-processing pipeline as HTTP endpoints. Endpoints are fire-and-forget: they kick off a step (or the whole pipeline) as a background asyncio task and return `{"status": "started"}` immediately (or `{"status": "busy"}` if the lecture is already running). Progress and per-step outcomes (done / error / rate_limited) live in the runner's in-flight + error state, which the frontend reads via `GET /status`.

## Pipeline stages

1. **strip_audio** — ffmpeg → mono 16 kHz 32 kbps MP3. Minimal size, enough for ASR.
2. **transcribe** — splits audio into 10-min chunks and calls Groq `whisper-large-v3` per chunk (Hebrew). Chunks because Groq enforces 25 MB per request. On a rate-limit interrupt, partial state is persisted as `transcript.partial.txt` + `transcript.partial.meta.json` so the next call resumes.
3. **summarize** — calls the Gemini API (`google-genai`) authenticated via `GEMINI_API_KEY`. The SDK only honors OAuth credentials in Vertex AI mode; the Developer API path used here requires an API key. The transcript (and optional material PDF) are uploaded as file parts; the Hebrew prompt at `assets/instructions/summarize.md` is sent alongside. Edit the prompt file to change output structure — no code change needed.
4. **to_pdf** — pandoc + XeLaTeX render to PDF. Hebrew font (Noto Serif Hebrew) is bundled in `assets/fonts/`. Math expressions (`$...$`, `$$...$$`) render correctly.
5. **upload_to_drive** — uploads the PDF to `{GDRIVE_ROOT_FOLDER}/{course}/[Recitations/]` in Google Drive and writes the share link to `drive_url.txt`.

## Directory layout

```
backend/
  assets/
    fonts/            NotoSansHebrew-*.ttf (body) + MiriamMonoCLM-*.ttf (dual-script mono for code blocks); all bundled, no system install
    instructions/     summarize.md (Hebrew prompt sent to Gemini); overview/{slug}.md (per-extractor Hebrew analysis prompts, filename = extractor slug — edit the file, no code change)
    templates/        pandoc_template.tex (XeLaTeX template for PDF output)
    filters/          ltr_code.lua (pandoc Lua filter wrapping code blocks in \begin{english} for LTR)
  pipeline/           per-LECTURE logic: pure functions, one module per step
    strip_audio.py       strip_audio(video_path, audio_path)
    transcribe.py        transcribe_audio(audio_path) -> str            (raises TranscribeRateLimitError)
    summarize.py         summarize(transcript_path, material_path=None) -> str (raises RuntimeError on Gemini API failure)
    to_pdf.py            convert_to_pdf(md_path) -> str (output path)
    upload_to_drive.py   upload_to_drive(pdf_path, course, file_name=None, subfolder=None) -> str (webViewLink)
    runner.py            unified per-lecture execution engine — step executors, in-flight tracking & orchestration
  course/             per-COURSE logic (aggregates across a course's lectures — never belongs in pipeline/)
    overview.py          registry ONLY (imports NO worker module — extract/analyze/collect/to_pdf import it back, so a worker import here would cycle): a `Phase` enum value type (each member carries `.id` = wire/CSV string + `.suffix` = on-disk output suffix; `Phase.from_id`), plus `Extractor` frozen-dataclass base (slug/title + a `phases: tuple[Phase, ...]` ClassVar; `phases_from(from_phase)` = the sub-chain to run — None or a phase this extractor lacks → its full chain; `output_file(phase)` = `f"{slug}{phase.suffix}"`) with `PatternExtractor` (transcript patterns, `prompt_file`, phases EXTRACT→ANALYZE→TO_PDF) and `ImmediateExtractor` (phases TOPICS→TO_PDF) subclasses; EXTRACTORS (keyed by kebab-case `slug` with a display `title`), EXTRACTORS_BY_SLUG. Phase order + suffix are intrinsic to `Phase`/each extractor's `phases` — there is NO global phase-order table. The extract/analyze/collect logic that consumes it lives in the phase modules below
    runner.py            thin overview driver — each trigger is one `OverviewRun` instance owning run-scoped SELECTION (slugs, from_phase, skip_existing) + the transcript `sources` (fetched ONCE lazily, memoized on the instance as `self.sources`), but NOT status. Module level keeps `_locks: dict[(course, slug) -> asyncio.Lock]` (per-(course, slug), persists across runs so same-slug triggers serialize) + the shared `_status: dict[course -> {slug -> entry}]` store the runs WRITE into (entry = `{"status", "phase"?, "message"?}`; survives after a run finishes so `get_status` reads it), plus `resolve_slugs`/`resolve_from_phase` (boundary parsers returning `(value, error)`; `resolve_from_phase` maps a from_phase id → `overview.Phase | None`, rejecting unknown ids so `main.py` stays thin). No global phase order lives here — each slug's chain comes from its `Extractor.phases_from(from_phase)`, and stored `phase` is always the STRING `phase.id` (a `Phase` object must never reach the JSON store). Locks are PER-(course, slug): a run holds ONLY the current slug's lock, so a SEPARATE trigger runs a DIFFERENT slug of the same course fully in PARALLEL ("let the user lead"); same slug + same course serialize on the lock; same slug in different courses run in parallel for free. `try_run_generate` seeds pending status synchronously (only for slugs NOT already in flight — never clobber a live entry), returns `"busy"` iff EVERY requested slug's lock is currently held, else builds the run + schedules `run.execute()`. `execute` is SLUG-BY-SLUG (declaration order): for each slug it does a NON-BLOCKING `lock.locked()` check then `async with lock` — an un-held `asyncio.Lock` acquires WITHOUT yielding, so with no await between check and acquire the skip-on-collision is atomic. COLLISION RULE = "first-come keeps it, other skips": a slug whose lock is already held by another run is SKIPPED, its entry left untouched (no notify). `get_status` DERIVES `running` (`any entry running`); phase is per-entry. Owns notify cadence + per-(slug,phase) failure isolation (`_run_slug_phase` marks "error", stops that slug's chain, keeps `phase` on the entry, doesn't abort the others)
    ranges.py            pure helper name_range(names) → {"start","end"} | None: first dotted-number token per name, natural-sorted min–max (no contiguity check). Snapshots a slug's source lecture/recitation range for overview/meta.json
    extract.py           extraction logic + extract phase worker: split_sentences, extract_snippets, build_report, fetch_sources(course, course_node), run_extractor(course, extractor, sources) → {slug}.txt snippet report (status dict; raises on I/O error). On "done" (never on skip / later-phase re-run) patches overview/meta.json for the slug with lecture/recitation ranges + generated_at
    analyze.py           analysis logic + analyze phase worker: MODEL/PROMPT_DIR + analyze(extractor, report, course) (LLMClient glue; raises RuntimeError on Gemini API failure), run_analyze(course, extractor) → {slug}.md (status dict; raises on Gemini/I/O error)
    collect.py           topics phase worker (for the ImmediateExtractor): pure parse/format helpers (parse_summary, _natural_key, _display_name, build_topics_md) + run_collect(course, course_node) → distills every lecture/recitation summary.md into `topics.md` as HEADERS ONLY (H2 topics + nested H3 subtopics, no list items; built-in sections dropped), with per-entry headings translated to Hebrew הרצאה/תרגול labels (status dict; "skipped" when no summaries, raises on I/O error). On "done" patches overview/meta.json for the `topics` slug with lecture/recitation ranges + generated_at
    to_pdf.py            to_pdf phase worker: run_to_pdf(course, slug) → {slug}.pdf via pipeline/to_pdf.py's convert_to_pdf (status dict; raises on render error). Renders both the pattern extractors' analyze output and topics' collect output. Distinct from pipeline/to_pdf.py — this is the per-course phase worker, that is the per-lecture md→PDF primitive it reuses. Each worker returns a "skipped"/"done" dict the runner folds into status; run-level state (running, notify) stays in the runner
  timing/             SQLite-backed per-operation duration log
    __init__.py          init_db, get_stats, _record, @timed_pipeline decorator
    timing.db            persistent store of (operation, file_size_bytes, duration_seconds)
    README.md
  tests/
    conftest.py       adds pipeline/ and backend/ to sys.path so tests can import modules
    test_to_pdf.py
    test_transcribe.py
    test_overview.py
    test_ranges.py
    test_extract.py
    test_analyze.py
    test_collect.py
    test_course_runner.py
    test_summarize.py
    test_runner.py
    test_upload_to_drive.py
  services/
    db_client.py      thin HTTP client for the database service (every read/write goes through here)
    google_auth.py    shared OAuth helper — loads credentials.json/token_drive.json, returns Credentials for a given scope set
    llm_client.py     shared Gemini client — LLMClient(model): generate(contents)/upload_file/delete_file, GEMINI_API_KEY auth, SDK errors → RuntimeError (used by summarize.py + course/analyze.py)
  main.py             FastAPI app + uvicorn entry point
  credentials.json    Google OAuth client (gitignored)
  token_drive.json    Google OAuth token cache (gitignored)
  pyproject.toml
```

## File naming convention per lecture

Each lecture lives at `{DATA_ROOT}/{course}/{lecture}/` (or `{DATA_ROOT}/{course}/Recitations/{name}/` for recitations) and accumulates these files:

| File                            | Produced by         |
|---------------------------------|---------------------|
| `video.mp4`                     | user / downloader   |
| `audio.mp3`                     | `/run/audio`        |
| `transcript.txt`                | `/run/transcribe`   |
| `transcript.partial.txt`        | `/run/transcribe` (on rate-limit) |
| `transcript.partial.meta.json`  | `/run/transcribe` (on rate-limit) |
| `material.pdf` (optional)       | user                |
| `summary.md`                    | `/run/summarize`    |
| `summary.pdf`                   | `/run/pdf`          |
| `drive_url.txt`                 | `/run/drive`        |

Paths under `DATA_ROOT` are not resolved here — every read/write goes through `services/db_client.py` (HTTP to the `database/` service on port 8001). The `(course, lecture, kind)` tuple is the only identifier the backend carries; `kind="recitation"` is forwarded as a query string so the database service injects the `Recitations/` segment.

## Docs

Folder is at: @docs , and it contains:
- @docs/PDF.md

## API endpoints

Per-step: `POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}` where `step ∈ {audio, transcribe, summarize, pdf, drive}`. `kind` defaults to `lecture`. The route validates that the step's prerequisite file exists, returning `{"status": "error", "message": "<file> is required — run <previous step> first"}` otherwise; on success it fires the step as a background task and returns `{"status": "started"|"busy"}`. Step results (e.g. `usedMaterial` for summarize, the `drive` URL, rate-limit progress) live in the runner's in-flight/error state, not the HTTP response.

Whole-lecture: `POST /courses/{course}/lectures/{lecture}/pipeline?kind=...` advances the lecture through every remaining step in the background; returns `{"status": "started"|"busy"}`.

Course overview is a fire-and-forget trigger that runs SLUG-BY-SLUG in the background, each slug under its OWN per-(course, slug) lock, returning `{"status": "started"|"busy"}` (`busy` iff EVERY requested slug is already in flight), or `{"status": "error", ...}` for an unknown extractor/course. Because a run holds only the current slug's lock, a SEPARATE trigger (e.g. the user regenerating one slug) runs a DIFFERENT slug of the same course in PARALLEL; same slug + same course serialize on the lock; a run reaching a slug whose lock is already held by another run SKIPS it ("first-come keeps it", the holder owns that status entry — no clobber). The outer loop walks the selected extractors in declaration order; each runs its own declared phases (`Extractor.phases`) from `from_phase` through to_pdf to completion before the next starts — so the first extractor's PDF is ready before the others begin. The three `PatternExtractor`s (exam-hints/student-qa/pitfalls) do extract→analyze→to_pdf; the one `ImmediateExtractor` (`topics`) does topics→to_pdf. An extractor only runs phases it declares — so a topics-only run never fetches transcripts and a pattern-only run never enters topics. Each entry carries a per-slug `phase` (its current/last phase, the string `phase.id`), so the UI's per-step spinner tracks the slug-by-slug run. There is no global phase-order table — the within-slug phase order + suffix live on the `Phase` enum and each `Extractor.phases`; the runner computes a slug's chain via `Extractor.phases_from(from_phase)` and dispatches per-phase in `_phase_worker`. `extractors` is an optional CSV of extractor **slugs** (default: all in `course/overview.py`'s `EXTRACTORS`). The slug (e.g. `exam-hints`) is the single identifier used on the wire, as the status-map key, and as the on-disk file stem — the display `title` (e.g. "Exam Hints") never appears in a filename or CSV. There is no per-phase endpoint; the frontend never sequences phases itself (mirrors `/run-all`).

- `POST /courses/{course}/overview/generate?extractors=exam-hints,topics&from_phase=extract&skip_existing=false` — runs the four phases for their participating extractors: extract (scans every lecture's/recitation's `transcript.txt` tree-driven, writes one `{slug}.txt` snippet report per pattern extractor), analyze (per pattern extractor reads its `{slug}.txt`, sends it to Gemini, writes `{slug}.md`; a missing `.txt` → `skipped` "no snippets file — run extract first"), topics (reads every `summary.md`, writes the aggregated `topics.md`; no summaries → `skipped` "no summaries found"), to_pdf (per participating extractor reads its `{slug}.md` and renders `{slug}.pdf` via `pipeline/to_pdf.py`'s `convert_to_pdf`; a missing `.md` → `skipped` "no analyzed markdown — run analyze first"). Optional `from_phase` (omitted → each extractor's full chain | `extract` | `analyze` | `topics` | `to_pdf`; unknown value → `{"status": "error"}`, parsed at the boundary by `resolve_from_phase` → `overview.Phase`) makes the run START from that phase and run through to_pdf — earlier phases are skipped, so their `{slug}.txt`/`.md` files are kept (never deleted); a missing input just yields the phase's usual `skipped`. A `from_phase` an extractor doesn't declare (e.g. `extract` reaching `topics`) falls back to that extractor's full chain (`Extractor.phases_from`). Optional `skip_existing` (default `false`) is a **continue** mode: `false` = EXACT current behavior, every participating phase OVERWRITES its output (the per-slug/per-step ↺ re-generate flows rely on this); `true` snapshots the overview dir once at run start (`db_client.list_overview_files`) and, per phase, KEEPS any participant whose output file already exists (filename via `Extractor.output_file(phase)` = `f"{slug}{phase.suffix}"`; suffixes extract→`.txt`, analyze/topics→`.md`, to_pdf→`.pdf`) — marking it `skipped` "already generated" without re-running its worker, while missing outputs generate normally. A kept extractor stays a participant for later phases (a kept `.txt` still lets analyze run if `.md` is missing) and is never treated as an error; the final status reflects the last phase it touched (fully-done slug → `skipped`; only the missing tail regenerated → `done`). One extractor's failure never aborts the others, and an extractor already in `error` from an earlier phase is left as-is and skipped by later phases (so the real failure survives to the final status, not masked as a downstream `skipped`). Each slug holds its own lock across its whole phase chain, so within a slug the UI shows one spinner with no false "done" flicker between phases.
- `GET /courses/{course}/overview/status` — `{"running": <any extractor entry running>, "extractors": {slug: {"status": "pending"|"running"|"done"|"skipped"|"error", "phase"?: "extract"|"analyze"|"topics"|"to_pdf", "message"?}}}` (snake_case on the wire). `running` is DERIVED (true iff any entry is `running`); `phase` now lives PER-ENTRY (the slug's current/last phase) — there is NO top-level `phase` or `started_at`. Never-run course → `{"running": false, "extractors": {}}`.
- `GET /overview/extractors` — static `{"extractors": [{"slug", "title", "phases"}]}` listing in `EXTRACTORS` declaration order, for the UI (slug = identifier/file stem, title = label, `phases` = the extractor's phase list so the UI can tell immediate extractors apart — pattern extractors `["extract","analyze","to_pdf"]`, topics `["topics","to_pdf"]`).

Runner: `POST /run-all` kicks off `runner.run_all()` as a background task (or returns `{status: "already_running", ...}` if a run is in progress, or `{status: "empty_queue"}` if nothing is pending). `GET /status` returns a snapshot from `runner.get_status()` — `{runner: {running, total, done, last_error}, in_flight: [...], errors: {...}}`. The runner also fires on a daily APScheduler cron at 03:00 (configured in `main.py`'s `lifespan`).

Timing: `GET /timing/{operation}?file_size_bytes=N` → linear-regression estimate from past runs (or `{"message": "not-enough-data"}`).

## Environment

Reads `.env` (repo root). Required:

- `GROQ_API_KEY` — Groq API key for Whisper transcription
- `GEMINI_API_KEY` — Gemini API key for the summarize step
- `GDRIVE_ROOT_FOLDER` — name of the root Google Drive folder
- `DATABASE_URL` (optional, default `http://localhost:8001`) — the database service base URL

## Running

Dependencies and the Python version (3.12, pinned in `.python-version`) are managed by [uv](https://docs.astral.sh/uv/). `uv run` auto-creates/syncs `backend/.venv` from `pyproject.toml` + `uv.lock` — no manual activation.

```bash
cd backend
uv sync --extra test             # one-time / after dep changes: build the venv
uv run uvicorn main:app --reload # dev (port 8000)
```

`--reload` watches the cwd (`backend/`), and the runner writes `timing/timing.db` there each run — so watchfiles logs a steady stream of "N changes detected" (SQLite touches the `.db` plus its journal). It's only noise (non-`.py`, so no actual restart), but to mute it `npm run dev` sets `UVICORN_RELOAD_EXCLUDE='*.db timing/*'` (uvicorn reads `UVICORN_`-prefixed env vars; it has no config-file support). Set the same env var if you launch uvicorn by hand.

## Running tests

```bash
cd backend
uv run pytest tests/ -q
```

CI runs exactly this on every push (any branch) — see `.github/workflows/ci.yml` (installs uv + pandoc 2.9.2.1, then `uv sync --extra test` + `uv run pytest`).

## Testing after every logic update

Whenever pipeline logic changes (anything under `pipeline/`, or any helper invoked by it), this is non-negotiable:

1. **Run existing tests first** — `uv run pytest tests/ -q`. Green baseline confirms the change didn't break adjacent behavior. If a test fails, fix the code or update the test deliberately — never silently delete or skip it.
2. **Add tests for the new logic** in the matching `tests/test_<module>.py`. Cover: the regression case (a test that fails without the fix), the happy path, and at least one edge case (empty input, escape/special chars, boundary between protected and unprotected regions). See `TestNormalizeMathSpans` and `TestForceLtrInlineCode` in `tests/test_to_pdf.py` for the shape.
3. **Re-run the full suite** after adding tests. The change isn't done until `uv run pytest tests/ -q` is green.

This applies even to "small" or "obvious" changes — preprocessing helpers in `to_pdf.py` look trivial but interact with bidi/LaTeX in surprising ways, which is exactly why every helper there has a dedicated test class.

## Key design decisions

- **All filesystem access goes through the database service.** `services/db_client.py` is responsible to call database API - get/put/exists/delete file, get/put summary. Endpoints download inputs to a `tempfile.TemporaryDirectory`, run the pipeline, and upload outputs back — keeping `pipeline/*` untouched as pure path-taking functions.
- Pipeline functions are pure: they take file paths / strings, no global state.
- Asset paths (`fonts/`, `summarize.md`, `pandoc_template.tex`) are resolved relative to `__file__` inside each pipeline module — they point to `backend/assets/`.
- CORS is open to `http://localhost:5173` only.
- Pipeline steps run as fire-and-forget asyncio tasks; endpoints return immediately (`started`/`busy`) and the frontend polls `GET /status`. A per-lecture `asyncio.Lock` serializes concurrent triggers for the same lecture.
- `summarize.py` raises `RuntimeError` on Gemini API failure (not `sys.exit`) so the endpoint can catch and return `{"status": "error"}`. Auth uses `GEMINI_API_KEY` from the environment — the `google-genai` SDK silently ignores OAuth `credentials=` outside of Vertex AI mode.
- `transcribe.py` raises `TranscribeRateLimitError` carrying `{limit, used, requested, retry_after_seconds, completed_chunks, total_chunks}` and writes partial state to disk; the next `/run/transcribe` call picks up from `transcript.partial.txt`. The transcribe endpoint round-trips the partial via the database service AND restores `audio.mp3`'s mtime from `transcript.partial.meta.json` — re-downloading audio.mp3 gives it a fresh mtime which would otherwise invalidate the resume meta and force a full restart.
- `timing/` records every pipeline operation's `(file_size, duration)` so the frontend can show calibrated ETAs.
- `runner.py` walks the tree looking for lectures that have `video.mp4` but lack `drive_url.txt` (`scan_pending`) and runs them sequentially through every missing step via `run_all(queue)`. It fires a `database/notify` SSE ping on each meaningful state change (step start/done, rate-limit start/wake, error, run start/complete) so the frontend can react without polling. On `rate_limited`, it sleeps `RATE_LIMIT_SLEEP_SECONDS` (3600s — Groq's hourly ASR window) and retries the same step.
- All in-flight state is tracked uniformly in `_in_flight` (skey → entry) regardless of trigger source — the runner, `/pipeline`, and individual `/run/{step}` calls all populate the same map. The frontend reads from `inFlight[]` and doesn't care which path queued the entry.
- **`pipeline/` is per-LECTURE logic; `course/` is per-COURSE logic.** Anything that aggregates across a course's lectures (the course overview feature) lives under `course/`, never `pipeline/`. `course/runner.py` mirrors the per-lecture `pipeline/runner.py`: overview doesn't fit the `(course, lecture, kind)`-keyed `_in_flight` map, so its state is a shared `_status` store (course → {slug → entry}) + per-(course, slug) locks there, keeping `main.py` thin route glue.
- The course overview feature aggregates every transcript in a course and writes to `{DATA_ROOT}/{course}/overview/` via the database service's overview endpoints (`db_client.put_overview_file` / `get_overview_file`; `db_client.get_overview_meta` / `patch_overview_meta` maintain the per-slug `overview/meta.json` — lecture/recitation number ranges + `generated_at`, written only when a slug's extract/topics phase produces output, so later-phase re-runs leave the snapshot intact — the merge is server-side + atomic). Whisper transcripts are near-unbroken blobs, so `course/extract.py` windows by sentence, never by line; one extractor's failure is recorded and the rest continue. `db_client.notify()` fires after EACH (slug, phase) work unit finishes (done/skipped/error/kept) and once at run end, so the frontend refreshes per ping. Transcripts are fetched ONCE for the whole run (lazily, the first time any slug enters extract) and cached — never re-read per slug.
- **The `topics` extractor is an `ImmediateExtractor`: it collects, it doesn't analyze.** Instead of the pattern extract→analyze→Gemini path, `course/collect.py` reads each `summary.md` directly and writes `topics.md` in the single `topics` phase; it then reuses the shared `to_pdf` phase to render `topics.pdf` (no LLM call). This is why the `ImmediateExtractor`'s `phases` places `TOPICS` before `TO_PDF`, and why phase filtering keys off each `Extractor.phases` ClassVar (a tuple of `Phase`).
- **Extractor identity is the `slug`, not the display name.** Each `Extractor` carries a kebab-case `slug` (the on-disk file stem, the status-map key, and the `?extractors=` CSV value) plus a human `title` used only in the UI and the report header. Its Gemini prompt lives at `assets/instructions/overview/{slug}.md` (a `prompt_file` property derives the name). Historically the display name doubled as the file stem, which desynced on-disk `exam-hints.txt` from the frontend's lookup of `Exam Hints.txt` — the slug split fixes that; keep filenames slug-based across backend, database, and frontend.
- `summarize.py` accepts an optional `material_pdf` path — when the lecture dir contains `material.pdf`, the endpoint downloads it into the workspace and passes it to Gemini alongside the transcript.
