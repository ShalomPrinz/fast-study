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
- **Only `bundles/` ships.** `formats/` is per-machine — the app builds its own `.fmt` on the first
  render, offline — so the script deletes it.

## `kitchen-sink.md`

Its contents come from enumerating the branches in `backend/assets/templates/pandoc_template.tex`
and `to_pdf.py`'s `LATEX_HEADER`, not from sampling summaries. Every block pulls in a package, and
dropping one drops that package from the cache. No summary in the corpus has a callout, table image,
link or strikeout, so `tcolorbox`, `graphicx` and `ulem` reach the cache only because the sink asks.

- **Primed raw**, skipping the bidi preprocessing: `wrap_english_phrases` rewrites a markdown image
  into text ([`backend/docs/BIDI.md`](../../backend/docs/BIDI.md#wrap_english_phrases)), so a
  preprocessed sink would never load `graphicx`. `probe.png` sits beside the `.tex` for the same reason.
- **Rendered strict** — no `-Z continue-on-errors`, unlike the app. Under the app's flags an
  unprimed package exits 0 with a plausible PDF; strict, it exits 1 naming the missing `.sty`. That
  proves the sink rendered whole under a template or engine change — never that the cache covers
  real content.

## `cache-supplement.txt`

The sink alone is not enough, and no document can be written that is. Primed from the sink the cache
holds 457 files, and against it **95 of 126 real summaries fail** — 25 with no PDF, 70 with a
silently damaged one at exit 0. Eleven more files take the corpus to zero failures (457 → 468).

Only two have a known trigger (inline math in a heading; doubly-nested sub/superscripts); the rest
come from _interactions_ between constructs, which enumerating template branches cannot reach. So
the list is hand-maintained with no generator, fetched by name with `tectonic -X bundle cat`, which
resolves the same default bundle a render does and lands under the same bundle hash.

**Re-check it after a template edit or a tectonic bump**: prime a fresh cache, strict-render the real
corpus against it, and either the diff is empty or it names the files to add.

## `tectonic-cache-filelist-linux.txt`

A WSL prime of the **sink alone**, kept so a Windows-primed cache can be diffed against it: 457 lines
under `bundles/` plus the one `formats/` `.fmt` that does not ship. `prime_cache.py --filelist`
therefore diffs 11 lines heavy by design — the supplement; anything beyond those is real drift.
