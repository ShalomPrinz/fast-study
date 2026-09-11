# delivery/

Build-time inputs for the packaged Electron build. Nothing here ships to users or is read at
runtime, and no dev command touches any of it.

| File                                | What it is                                                              |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `services.spec` + `entry.py`        | The PyInstaller one-dir bundle holding `backend/` and `database/`       |
| `stage.mjs`                         | Assembles `stage/`, the tree electron-builder ships as `resources/`     |
| `prime_cache.py`                    | Fills tectonic's LaTeX package cache with everything the app can render |
| `kitchen-sink.md` + `probe.png`     | The document the prime renders                                          |
| `cache-supplement.txt`              | Files the sink does not pull, added to the cache by name                |
| `tectonic-cache-filelist-linux.txt` | A primed cache's contents, kept as a diff baseline                      |

## The installer

`.github/workflows/release.yml`, run by hand from the Actions tab, is the only thing that produces
one. It runs on `windows-latest` because neither PyInstaller nor electron-builder's NSIS target can
cross-compile from WSL, so nothing here is buildable on a dev machine — which is also why everything
the build reads has to be committed, `backend/credentials.json` alone excepted: it arrives as the
`GOOGLE_CREDENTIALS_JSON` Actions secret, and a build without it still produces a bundle, just one
that cannot do Drive consent.

Roughly 20 minutes end to end, most of it the LaTeX prime and ~450MB of binary downloads. The
artifact is one unsigned per-user NSIS `.exe`.

### Publishing one

The dispatch takes a `publish` boolean, and it defaults to **false**: an ordinary run builds the
installer and uploads it as a workflow artifact, publishing nothing. That default is the whole
review gate — the workflow runs no tests, and the failures packaging actually produces only appear
on a clean Windows machine, so the artifact from a `publish=false` run is what the release
smoke-test checklist is run against.

`publish=true` runs `npm run release` instead of `npm run dist`, and electron-builder's GitHub
publisher creates a **live** release on the public `ShalomPrinz/fast-study` tagged `v<version>`,
carrying the `.exe`, its `.blockmap` and `latest.yml`. That `latest.yml` is what every installed
copy's updater reads; without it the release is invisible to them. There is no draft step — a
release is published the moment the run goes green, and pulling one back means deleting it.

Bump `version` in `electron/package.json` in a commit **before** dispatching. It is the tag, the
installer's file name and what `app.getVersion()` reports, and publishing twice from one version
fails on the existing tag. The launcher's side of this — the silent check, the download and the
install on quit — is [`electron/docs/UPDATES.md`](../electron/docs/UPDATES.md).

Unsigned means **SmartScreen blocks the first run** on every machine: the dialog reads "Windows
protected your PC" with only a Don't run button, and the installer starts from **More info → Run
anyway**. There is no way around it short of an OV/EV certificate. Installing is per-user into
`%LOCALAPPDATA%\Programs\FastStudy`, so no UAC prompt stacks on top of that — and it is what leaves
the install directory writable, which is where tectonic builds its `formats/` on the first render.

The three tool versions the workflow pins are claims the repo has measured, not conveniences:
tectonic is the engine the shipped cache was primed against, pandoc 2.9.2.1 is the last version
`text_direction.lua` survives, and ffmpeg is pinned only so a build is reproducible. yt-dlp is
deliberately unpinned — it rots as YouTube changes signatures, so a build ships the newest one.

## Staging the resources tree

```bash
node delivery/stage.mjs delivery/stage
```

Copies the four built services into the shape `electron/docs/BOOT.md` calls the packaged tree, which
`electron/package.json`'s single `extraResources` entry then ships as `resources/`. It refuses to
finish if either Node service's `@faststudy/*` dependency is still a symlink: `file:` deps install as
links by default, and a link into `lib/` dangles the moment the tree leaves the repo — so both
services are installed with `npm ci --install-links`.

`bin/` and `latex/` are not its business. The workflow downloads the binaries and primes the tectonic
cache straight into `stage/`, so neither is copied twice.

## Priming the LaTeX cache

```bash
cd backend && uv run python ../delivery/prime_cache.py <out-dir>
```

Tectonic fetches each LaTeX package on first use, so a cache holds only what was actually rendered
— and the shipped app can never fetch a missing one: it renders with `TECTONIC_CACHE_DIR` pointing
at the frozen `bundles/` and `--only-cached` set. Anything absent is a failed render on a user's
machine, offline and unfixable.

The script drives tectonic itself rather than going through `convert_to_pdf`, because `to_pdf.py`
reads `TECTONIC_CACHE_DIR` as "the cache is frozen" and adds `--only-cached` — which would forbid
the very fetches priming consists of. It reuses `build_tex` for the pandoc half, so the `.tex` it
primes from is the one the pipeline generates.

Only `bundles/` ships. `formats/` is per-machine — the app builds its own `.fmt` on the first
render, once, offline — so the script deletes it.

A cold prime is network-bound at roughly 7.5 minutes.

### `kitchen-sink.md`

Deliberately over-stuffed, and its contents come from enumerating the branches in
`backend/assets/templates/pandoc_template.tex` and `to_pdf.py`'s `LATEX_HEADER` — not from sampling
summaries. Every block pulls in a package: dropping one drops that package from the cache. No
summary in the corpus contains a callout, table image, link or strikeout, so `tcolorbox`, `graphicx`
and `ulem` reach the cache only because the sink asks for them.

It is primed **raw**, skipping the bidi preprocessing the pipeline applies, which is why
`prime_cache.py` calls `build_tex` rather than `convert_to_pdf`. `wrap_english_phrases` rewrites
`![alt](img.png)` into `!\LR{[alt]}\LR{(img.png)}` before pandoc sees it, so a preprocessed sink
would never load `graphicx`.

The render is **strict — no `-Z continue-on-errors`**, unlike the app's. Under the app's own flags an
unprimed package exits 0 and produces a plausible PDF; without the flag the same document exits 1 and
names the missing `.sty`. That check covers the sink only, and is a regression check on the sink
under a template or engine change — it cannot prove the cache covers real content.

### `cache-supplement.txt`

The sink alone is not enough, and no document can be written that is. Primed from the sink the cache
holds 457 files, and against it **95 of 126 real summaries fail** — 25 producing no PDF and 70 more a
silently damaged one at exit 0. Eleven files close it completely; 457 → 468 takes the corpus to zero
failures.

Only two of the eleven have a known trigger (inline math inside a heading; doubly-nested
sub/superscripts). The rest are demanded by _interactions_ between constructs, which is exactly what
enumerating template branches cannot reach. So they are a hand-maintained list with no generator
behind it, fetched by name with `tectonic -X bundle cat`, which resolves the same default bundle a
render does and lands them under the same bundle hash.

**Re-check it after a template edit or a tectonic bump**: prime a fresh cache, strict-render the real
corpus against it, and either the diff is empty or it names the files to add.

### `tectonic-cache-filelist-linux.txt`

What a WSL priming run produced, kept so a Windows-primed cache can be diffed against it. 458 lines:
457 under `bundles/` — the base the 468 above counts from — plus the one `formats/` entry, the
`.fmt` that does not ship.

It records the **sink alone**, so `prime_cache.py --filelist` diffs against it 11 lines heavy by
design — the supplement. Anything beyond those eleven is real drift.
