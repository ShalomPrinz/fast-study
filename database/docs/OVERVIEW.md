# OVERVIEW — the course-level file area

`{DATA_ROOT}/{course}/overview/` holds cross-lecture study files produced by the backend's
overview step (one per extractor, e.g. `exam-hints.txt` / `exam-hints.pdf`). It sits beside
lectures but is **not** one: `fs/tree.py` skips it exactly like `Recitations`, so it never
appears as a lecture row.

Writes are neutral — no artifact wipe, no side effects — and create `overview/` on demand, but
404 when the course itself doesn't exist, so a typo'd course name can't silently mint a tree. A
file the user has open in a viewer answers `423`, the same as a lecture file.

## Per-slug pdf warnings

`{slug}.pdf` carries its non-fatal LaTeX warning in `.{slug}.pdf_warning`, inlined onto the
listing entry as `warning`. This mirrors `summary.pdf` in the lecture tree (see LAYOUT.md),
including the absent/empty/unreadable ⇒ *no key* rule. One marker per slug: a failed render of
one extractor must not taint another's pdf.

The listing skips all dotfiles, so markers — and any metadata added later — never become rows.

The backend writes and clears markers through the ordinary `PUT /…/overview/files/{name}` route:
dot-prefixed names pass validation, and writing an empty body clears the warning. No dedicated
endpoint exists, and none is needed.

## meta.json atomicity

`overview/meta.json` is a `{slug: entry}` map patched one slug at a time. The read-modify-write
in `set_meta_entry` (behind both `merge_overview_meta` and `merge_merged_meta`) is safe against concurrent PATCHes without any lock, for two reasons —
both load-bearing:

1. The route is `async def`, so it runs on the single event loop rather than a threadpool, and
   the body contains **no `await`**. Cooperative scheduling means the RMW runs to
   completion before another coroutine can interleave. **Never add an `await` inside
   `set_meta_entry` or between its callers and it** — that alone reintroduces the race.
2. The write is temp-file + `os.replace`, so no reader and no crash can observe a torn file.

An `asyncio.Lock` would be redundant while rule 1 holds, so there isn't one.

Two cases this does not cover. Running uvicorn with multiple workers puts separate event loops in
play and would need `flock` or rename-based coordination. And a torn read from an *external*
writer is still possible — which is why `read_overview_meta` swallows parse errors and degrades
to `{}`, self-healing on the next write.

## Merged PDFs

`overview/merged/{name}.pdf` is a PDF the backend builds by joining chosen lectures' and
recitations' `summary.pdf`; `overview/merged/meta.json` is its history. `name = safe_name(title.strip())`,
so two titles that sanitize alike are one entry and overwrite each other; the subfolder keeps titles
from colliding with extractor files. The overview listing skips it (it lists files only) and the
tree skips `overview/`.

`meta.json` is `{name: {title, created_at, parts: [{name, kind, pdf_mtime}]}}`, `parts` in merge
order, an entry replaced wholly on PATCH. It reuses the atomic single-writer read-modify-write
above (`set_meta_entry`) and the same degrade: corrupt reads as `{}`. There is no delete route.

`GET /…/merged` lists entries whose pdf exists, newest first. Each part gains `exists` (the folder
is still in the course) and `current_pdf_mtime` (ISO UTC, absent without a `summary.pdf`); the item
gains `stale`, true when any existing part's current mtime is later than its recorded `pdf_mtime`
(compared as parsed datetimes, never strings). The backend reads a part's bytes from
`GET /…/lectures/{name}/files/summary.pdf?kind=` and its mtime from the tree's
`files["summary.pdf"].mtime` (float epoch).
