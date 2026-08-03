# OVERVIEW — the course-level file area

`{DATA_ROOT}/{course}/overview/` holds cross-lecture study files produced by the backend's
overview step (one per extractor, e.g. `exam-hints.txt` / `exam-hints.pdf`). It sits beside
lectures but is **not** one: `fs/tree.py` skips it exactly like `Recitations`, so it never
appears as a lecture row.

Writes are neutral — no artifact wipe, no side effects — and create `overview/` on demand, but
404 when the course itself doesn't exist, so a typo'd course name can't silently mint a tree.

## Per-slug pdf warnings

`{slug}.pdf` carries its non-fatal XeLaTeX warning in `.{slug}.pdf_warning`, inlined onto the
listing entry as `warning`. This mirrors `summary.pdf` in the lecture tree (see LAYOUT.md),
including the absent/empty/unreadable ⇒ *no key* rule. One marker per slug: a failed render of
one extractor must not taint another's pdf.

The listing skips all dotfiles, so markers — and any metadata added later — never become rows.

The backend writes and clears markers through the ordinary `PUT /…/overview/files/{name}` route:
dot-prefixed names pass validation, and writing an empty body clears the warning. No dedicated
endpoint exists, and none is needed.

## meta.json atomicity

`overview/meta.json` is a `{slug: entry}` map patched one slug at a time. The read-modify-write
in `merge_overview_meta` is safe against concurrent PATCHes without any lock, for two reasons —
both load-bearing:

1. The route is `async def`, so it runs on the single event loop rather than a threadpool, and
   the merge body contains **no `await`**. Cooperative scheduling means the RMW runs to
   completion before another coroutine can interleave. **Never add an `await` inside
   `merge_overview_meta`** — that alone reintroduces the race.
2. The write is temp-file + `os.replace`, so no reader and no crash can observe a torn file.

An `asyncio.Lock` would be redundant while rule 1 holds, so there isn't one.

Two cases this does not cover. Running uvicorn with multiple workers puts separate event loops in
play and would need `flock` or rename-based coordination. And a torn read from an *external*
writer is still possible — which is why `read_overview_meta` swallows parse errors and degrades
to `{}`, self-healing on the next write.
