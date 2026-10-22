# The shipped LaTeX cache

Tectonic fetches each LaTeX package on first use, so a cache holds only what was actually rendered.
The shipped app never fetches: the launcher points `TECTONIC_CACHE_DIR` at the frozen cache and the
backend then renders `--only-cached` ([`backend/docs/PDF.md`](../../backend/docs/PDF.md#timeouts)).
Anything absent is a failed render on a user's machine, offline and unfixable. `prime_cache.py`
builds that cache; a cold prime is network-bound at roughly 7.5 minutes.

## The prime

- **It drives tectonic itself**, not `convert_to_pdf`: the backend reads `TECTONIC_CACHE_DIR` as "the
  cache is frozen" and adds `--only-cached`, which forbids the very fetches priming consists of. It
  reuses `build_tex` for the pandoc half, so the `.tex` is the one the pipeline generates.
- **`bundles/` and `formats/` both ship.** The sink's render builds tectonic's `latex` format as
  `formats/<hash>-latex-33.fmt`, so the app's `--only-cached` renders load it rather than build one;
  smoke test 6 fails if a render adds or rewrites a file there.

## `kitchen-sink.md`

Its contents come from enumerating the branches in `backend/assets/templates/pandoc_template.tex`
and `to_pdf.py`'s `LATEX_HEADER`, not from sampling summaries. Every block pulls in a package, and
dropping one drops that package from the cache. No summary in the corpus has a callout, table image,
link or strikeout, so `tcolorbox`, `graphicx` and `ulem` reach the cache only because the sink asks.
Its doubly-nested `\mathbf` line pulls Latin Modern bold math at 10/7/5pt, which body `\mathbf`
needs; without it a render fails `pdf_missing_font`.

- **Primed raw**, skipping the bidi preprocessing: `wrap_english_phrases` rewrites a markdown image
  into text ([`backend/docs/BIDI.md`](../../backend/docs/BIDI.md#wrap_english_phrases)), so a
  preprocessed sink would never load `graphicx`. `probe.png` sits beside the `.tex` for the same reason.
- **Rendered strict** — no `-Z continue-on-errors`, unlike the app. Under the app's flags an
  unprimed package exits 0 with a plausible PDF; strict, it exits 1 naming the missing `.sty`. That
  proves the sink rendered whole under a template or engine change — never that the cache covers
  real content.

## `cache-supplement.txt`

The sink alone is not enough, and no document can be written that is. Measured against the sink when
it primed 457 files, **95 of 126 real summaries fail** — 25 with no PDF, 70 with a silently damaged
one at exit 0. The current sink primes 466 files (465 under `bundles/` plus the `.fmt`); the
supplement's 110 take it to 576, 48.5MB.

Math goes through the 8-bit TFM path — `lmodern` and `amssymb` under `fontspec[no-math]` — and which
design size a construct loads depends on where it sits: body, script and scriptscript at 10/7/5pt,
footnotes and headings at 8 through 14.4pt. Sampling constructs never closed that set, so the
supplement closes it instead: every size each family's `.fd` maps the 5–14.4pt range to, as both
`.tfm` and `.pfb`, for OT1 `lmr` (`m/n`, `bx/n`, `m/it`), `lmss` and `lmtt`; OML `lmm` (`m`, `b`);
OMS `lmsy` (`m`, `b`); OMX `lmex`; and U `msa`, `msb` and `euf`, plus the `.fd`/`.cfg`/`.enc` they
read, and the 12pt `lmroman12` `.otf` heading text uses. It lists only the names the sink does not
already pull. Two failure shapes, both offline-only:

- **A missing `.tfm`** is `! Font ... not loadable` in the log: `pdf_missing_font`, or `latex_error`
  once a later error masks it.
- **A missing `.pfb`** passes XeTeX — the `.tfm` is enough to typeset — and fails xdvipdfmx with no
  PDF, `pdf_engine_no_output`. `$\checkmark$` alone did this when `msam10.tfm` was cached and
  `msam10.pfb` was not.

`eufm`/`eufb` 6, 8 and 9 have no `.pfb` in the bundle, and `ueuf.fd` maps those sizes to 5/7/10, so
they ship as `.tfm` only. The list is hand-maintained, fetched by name with `tectonic -X bundle cat`,
which resolves the same default bundle a render does and lands under the same bundle hash.

**Re-check it after a template edit or a tectonic bump**: prime a fresh cache, strict-render the real
corpus against it, and either the diff is empty or it names the files to add. A template edit that
loads a new math family or alphabet, or changes the 10pt base size, re-opens the set itself.

## `tectonic-cache-filelist-linux.txt`

A WSL prime of the **sink alone**, kept so a Windows-primed cache can be diffed against it: 465 lines
under `bundles/` plus the one `formats/` `.fmt`, whose name is the same on both. `prime_cache.py
--filelist` lists both directories, so it diffs 110 lines heavy by design — the supplement; anything
beyond those, a renamed `.fmt` included, is real drift.
