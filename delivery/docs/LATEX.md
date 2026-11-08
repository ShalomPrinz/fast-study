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

### Across runs

`build.yml` restores the primed directory from an Actions cache before the prime and saves it with a
separate `actions/cache/save` step right after the wait step passes, so a failed or partial prime is
never saved and a later failure or a cancelled run does not lose a good one.

- **The key is exact**: `latex-<os>-tectonic<TECTONIC_VERSION>-pandoc<PANDOC_VERSION>-<hash>`, the
  hash over `prime_cache.py`, the sink, `probe.png`, `probe.pdf`, the supplement, `backend/pipeline/to_pdf.py`
  (`LATEX_HEADER`) and `backend/assets/{templates,filters,fonts}/`. There are no `restore-keys`: the
  prime only adds files, so a partial match would carry files no input pulls any more into every
  installer from then on.
- **The prime runs on a hit too.** Restored, it is a top-up of reused files, but its strict render
  is still the proof the shipped cache renders the sink; skipping it would ship a cache that fails
  offline whenever an input changed without changing the key. What a hit's top-up adds is not
  saved, since a key's cache is immutable — it is refetched on every run until the key moves.
- **Scope and eviction are GitHub's**: a run reads its own branch's caches and `main`'s, and a
  cache saved on another branch is visible only to that branch, so the first `main` run after
  merging a key change misses. A cache unused for 7 days, or the oldest once the repo passes 10GB,
  is evicted; either way that run primes cold.

## `kitchen-sink.md`

Its contents come from enumerating the branches in `backend/assets/templates/` — pandoc 3.13's
stock template, its embedded partials (`pandoc --print-default-data-file templates/common.latex`)
and the local `fonts.latex` — and `to_pdf.py`'s `LATEX_HEADER`, not from sampling summaries. Every
block pulls in a package, and dropping one drops that package from the cache. Summary figures
are a pdfium-cropped one-page PDF (`probe.pdf`) and a PNG (`probe.png`), both included by
xdvipdfmx natively, so neither adds a cache file beyond `graphicx`, which a summary with figures
loads. No summary in the corpus has a callout, link, strikeout, `\cancel` or spanning grid table, so
`tcolorbox`, `soul`, `cancel` and `multirow` reach the cache only because the sink asks. `svg` is the
one branch left out: it needs Inkscape, which never ships.
Its doubly-nested `\mathbf` line pulls Latin Modern bold math at 10/7/5pt, which body `\mathbf`
needs; without it a render fails `pdf_missing_font`.

- **Primed raw**, skipping the bidi preprocessing, which adds no package of its own.
  `probe.png` and `probe.pdf` sit beside the `.tex` because `drop_missing_images.lua` silently drops
  an image that is not a file in the build dir, and with no image left `graphicx` never loads.
- **Rendered strict** — no `-Z continue-on-errors`, unlike the app. Under the app's flags an
  unprimed package exits 0 with a plausible PDF; strict, it exits 1 naming the missing `.sty`. That
  proves the sink rendered whole under a template or engine change — never that the cache covers
  real content.

## `cache-supplement.txt`

The sink alone is not enough, and no document can be written that is. Measured against the sink when
it primed 457 files, **95 of 126 real summaries fail** — 25 with no PDF, 70 with a silently damaged
one at exit 0. The current sink primes 484 files (483 under `bundles/` plus the `.fmt`); the
supplement's 117 take it to 601, 48.9MB.

Math goes through the 8-bit TFM path — `lmodern` and `amssymb` under `fontspec[no-math]` — and which
design size a construct loads depends on where it sits: body, script and scriptscript at 10/7/5pt,
footnotes and headings at 8 through 14.4pt. Sampling constructs never closed that set, so the
supplement closes it instead: every size each family's `.fd` maps the 5–14.4pt range to, as both
`.tfm` and `.pfb`, for OT1 `lmr` (`m/n`, `bx/n`, `m/it`), `lmss` and `lmtt`; OML `lmm` (`m`, `b`);
OMS `lmsy` (`m`, `b`); OMX `lmex`; and U `msa`, `msb`, `euf` and `stmry`, plus the `.fd`/`.cfg`/`.enc`
they read, and the 12pt `lmroman12` `.otf` heading text uses. `stmry` loads at the first math in
every size whether or not a glyph is drawn, so the sink pulls most of its `.tfm`s but none of its
`.pfb`s. The supplement lists only the names the sink does not already pull. Two failure shapes,
both offline-only:

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

A WSL prime of the **sink alone**, kept so a Windows-primed cache can be diffed against it: 483 lines
under `bundles/` plus the one `formats/` `.fmt`, whose name is the same on both. `prime_cache.py
--filelist` lists both directories, so it diffs 117 lines heavy by design — the supplement; anything
beyond those, a renamed `.fmt` included, is real drift.
