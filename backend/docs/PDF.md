# PDF rendering — pandoc + tectonic

`pipeline/to_pdf.py` preprocesses the markdown with the pure helpers in `pipeline/pdf/`, then renders with pandoc → tectonic under polyglossia's `\setmainlanguage{hebrew}`, using the bundled fonts, the template in `assets/templates/` and the Lua filter in `assets/filters/`. Getting Hebrew RTL with English islands right — engine limits, the filter, the preprocessing chain, and how to verify a fix — is [BIDI.md](BIDI.md).

Tectonic is a self-contained XeTeX: same engine and output — verified glyph-for-glyph against xelatex over 85,492 glyphs — but it resolves LaTeX packages from its own cache instead of a system TeX Live, which is what makes the toolchain shippable.

## The render

`convert_to_pdf(md_path) -> (pdf_path, warning|None)` runs the two tools itself rather than letting pandoc drive the engine:

1. **pandoc → `build.tex`** (no `--pdf-engine`), so the generated LaTeX is a file we own. This is `build_tex(markdown, build)`, a seam a second caller can reuse; it takes **pandoc-ready** markdown — preprocessing is the caller's.
2. **`tectonic --keep-logs -Z continue-on-errors build.tex`, once** — tectonic reruns TeX to convergence itself, so there is no second pass to drive.

Both run in one tempdir as cwd, so no aux file leaks beside the markdown; `build.pdf` is moved onto the output path at the end.

Two flags are load-bearing. **`--keep-logs`**, or tectonic discards `build.log` — where every recoverable error and missing font is reported. **`-Z continue-on-errors`** replaces xelatex's `-interaction=nonstopmode`: without it a recoverable error yields no PDF and the warning path below is unreachable. Tectonic labels it unstable, which is why the version is [pinned](../../delivery/docs/RELEASE.md#pinned-tool-versions); if it goes away the fallback is hard-fail-only rendering with no `.pdf_warning`.

**The fonts travel with the build.** The four `.ttf`s are copied into the build tempdir and the header's `Path=` is `./`. fontspec folds `Path=` and the font name into one bracketed spec — `[C:/…/Font.ttf]/OT` — which tectonic hands to Win32 as a filename; with `C:` out of drive position Windows rejects it (`os error 123`), and with backslashes verbatim `\Users` is read as a control sequence. `./` is the same on both platforms and either engine, so it is unbranched.

**A concurrent first-ever render can lose the format-build race** on Windows (`failed to persist temporary file`); the rename is atomic, so one retry runs warm.

### Timeouts

Every tool call goes through `_run_tool`, which turns a `TimeoutExpired` into a `PdfRenderError` (carrying the `.tex` when pandoc produced one). The caller holds a per-lecture lock across the render, so an unbounded hang would leave the lecture permanently `busy`.

pandoc is bounded at 60s. The render is bounded at 60s **when the cache is frozen** — `TECTONIC_CACHE_DIR` set, which only the launcher does, and `--only-cached` then forbids any fetch — and at 900s otherwise. A real summary renders in ~3s against a warm cache, so 60s is already wedged; but a dev cache starts empty and the first render fetches the LaTeX bundle, which takes minutes once per machine.

## Outcomes

`-Z continue-on-errors` lets TeX skip past an error and **still emit a PDF** — and still exit **0**. So the outcome is read out of `build.log`, never off the return code, which would drop the warning on exactly the runs it exists for.

| Outcome                                   | Result                                                          |
| ----------------------------------------- | --------------------------------------------------------------- |
| no `! …` in the log, exit 0               | success, `warning is None`                                      |
| a `! Font …` in the log                   | `PdfRenderError` — never a warning, see below                   |
| any other `! …`, PDF exists and non-empty | accepted, returned with the classified warning                  |
| no `! …` but non-zero exit                | accepted, warned with tectonic's own `error:` lines             |
| no PDF, or a 0-byte PDF                   | `PdfRenderError`; `_require_nonempty` agrees                    |
| either tool times out                     | `PdfRenderError`, carrying the `.tex` if pandoc produced one    |

A damaged region renders wrong or blank while the rest is fine — far more robust than guessing which source line to excise.

### A missing font is a hard failure

A font the engine cannot load is dropped **glyph by glyph**: exit 0, a plausible PDF, and an `$N$` silently gone from a heading. Every other recoverable error is visible — a bad page announces itself — but a dropped glyph is invisible by construction: the sentence reads, only the symbol it was about is missing. A warning on that is a corruption channel, so `! Font …` lines raise instead. This is also the only check covering content nobody has written yet, which makes it the last line of defence for the shipped LaTeX cache.

### Reading tectonic's streams

Tectonic sends `note:` to stdout but `error:`, `warning:` and panics to **stderr**. Two failures name their cause nowhere else: a cold-cache panic exits 101 with no `build.log`, and an unrecoverable font failure writes a log with **zero `!` lines** ending `Output written on build.xdv` — reading like success for a render that produced nothing.

`_tectonic_errors` extracts `^error:` lines rather than tailing: a failed run can emit ~1000 `Missing character` lines, burying the one that matters. **Non-empty stderr is not failure** on either platform — Windows always emits a Fontconfig complaint, Linux `warning:` lines even on a clean run. Success is the exit code plus `built_pdf.exists()`.

## The warning markers

`_exec_pdf` persists the outcome as two dotfiles in the lecture dir (the pipeline function stays pure):

- `.pdf_warning` — the one-line warning, written after the PDF upload succeeds and deleted on a clean render, so it never outlives or precedes its PDF. The database inlines it onto the `summary.pdf` tree entry.
- `.pdf_build.tex` — the generated LaTeX, kept only on a hard failure, carried out of the tempdir by `PdfRenderError.tex_source`.

Neither may outlive the build it describes — a warning's `l.<N>` and the surviving `.tex` must come from the same build. A render that produced a PDF drops a stale `.pdf_build.tex`. A hard failure that **stored a new `.pdf_build.tex`** drops the previous PDF's `.pdf_warning`; a failure with no `.tex` (pandoc, a pandoc timeout) or a failed upload leaves the old pair agreeing, so the badge stays. Deleting `summary.pdf` drops both — that rule lives in the database service. Both cleanups are best-effort (`_drop_marker`): the real outcome is already persisted, and a failing delete must not restate a good render as an error and skip its `notify()`.

**Course overview PDFs** (`course/to_pdf.py`) keep the warning in `.{slug}.pdf_warning`, again written only after the upload, but a clean render writes it **empty** rather than deleting it — the database has no overview delete route, and reads an empty marker as no warning. There is no `.pdf_build.tex` equivalent: a hard failure is the slug's error.

## Failure messages

Errors and warnings alike are classified by `pipeline/pdf/tex_errors.py` into one short line — first `! …` error, its line, the error point, a count of the rest — because they reach the user as a toast. `l.<N>` indexes the **generated** `.tex`, never `summary.md`, which is why a hard failure keeps it as `.pdf_build.tex`.

A `PdfRenderError` also carries the same facts as a machine `code` and flat `params` ([docs/ERROR-CODES.md](../../docs/ERROR-CODES.md)): `latex_error` with `{message, line, at, more_count}` whenever a `! …` was parsed — `message` and `at` being the engine's own untranslated text — and otherwise the caller's own code, `pdf_pandoc_failed`, `pdf_engine_no_output`, `pdf_tool_timeout`, `pdf_missing_font` or `pdf_asset_missing`. The `.pdf_warning` marker stays a plain line: it rides the tree as a string the database inlines, not one of the wire channels that carry a code.

pandoc's failure is classified over both its streams; the render over `build.log`, falling back to tectonic's `^error:` lines when the log has no `! …` — the two describe different failures, so neither substitutes for the other. With neither, the log **tail** is kept, capped at 2000 chars. A missing binary never reaches this path: `subprocess.run` raises `FileNotFoundError` first, and the boot probe has already reported it on `/health`.
