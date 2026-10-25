# LAYOUT — on-disk conventions

This service is the single source of truth for the `DATA_ROOT` layout. Other services never
build paths; they pass `(course, lecture, kind)` and let `fs/paths.py` resolve them.

```
{DATA_ROOT}/{course}/{lecture}/...              lectures
{DATA_ROOT}/{course}/Recitations/{name}/...     recitations
{DATA_ROOT}/{course}/Assignments/{name}/...     assignments: a named folder of files, filenames sanitized like folder names
{DATA_ROOT}/{course}/overview/...               course-level files (see OVERVIEW.md)
```

`lecture_dir(course, lecture, kind)` is the only resolver — `kind="recitation"` inserts the
`Recitations` level. `assignment_dir(course, name)` resolves an assignment; assignments are not a
lecture kind, so no video, summary, materials or pipeline route can address one. Re-encoding this layout anywhere else (here or in another service) is the
one thing that breaks the arrangement.

Every resolver runs course and lecture names through `safe_name()` first (below). A file name
inside a resolved dir is a caller's string instead, so every helper that joins one puts it through
`check_safe_segment()` — separators, `..` and NUL are refused rather than laundered.

One file this service writes sits outside `DATA_ROOT` entirely: the repo-root `.env` behind the
settings store — see [SETTINGS.md](SETTINGS.md).

## Names

Course and lecture names become directory names verbatim, and they arrive from two places: a
user typing one, and the auto-downloader scraping a lecture-site title. ext4 accepts nearly
anything, NTFS does not — so `שיעור 3: מבוא` works in development and fails on a Windows
install. `safe_name()` is the single chokepoint, applied inside the resolvers rather than at the
API boundary so reads and writes agree and no caller can bypass it.

The rule, in order:

| Step    | Rule                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| Drop    | `<` `>` `:` `"` `/` `\` `\|` `?` `*` and control characters — removed, never substituted |
| Trim    | Whitespace, then trailing dots and spaces — Windows strips those silently, which would desync the name from the directory |
| Cap     | 80 characters, leaving headroom under `MAX_PATH` for `DATA_ROOT` + `Recitations/` + the longest artifact name |
| Reserve | `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` get a `_` right after the base, before the first dot (`CON_`, `com1_.txt`, `con _.x`) — reserved with an extension too |
| Reject  | A name with nothing legal left raises, surfacing as a `400`                              |

Illegal characters are dropped rather than substituted because a separator would have to be a legal
character, so it becomes visible punctuation the user never typed — and the common case is a colon
or slash already sitting beside a space, where a replacement stacks a separator against that space
and reads worse than the gap dropping leaves. Dropping is also trivially idempotent, which the
resolvers depend on; a replacement rule has to be written carefully not to collapse runs differently
on a second pass. This is deliberately not exposed as a setting: reversing it is a migration once
directories exist on disk, not a config change.

A lecture or recitation whose sanitized name matches `overview`, `Recitations` or `Assignments`, case-insensitively
since NTFS is, is refused on create and rename with `409` `name_reserved`: the tree skips those folders,
so the lecture would vanish into the course's own. Course names need no such check — nothing else
lives at the data root.

The rule is idempotent, which is what the arrangement rests on: a name read back off disk
resolves to itself, so renames and tree round-trips are stable. `read_course` takes its name
straight from the `iterdir()` walk and is the one place that deliberately skips sanitizing.

Sanitization is silent on create, which returns `204`; the tree, listing real directory names over
SSE, shows the result. Rename answers `200 {name}` with the effective name, so a caller keeps addressing the real folder.

Two cases are knowingly unhandled: two names in one course that sanitize identically merge into
one directory, and no Unicode normalization happens, so a name could round-trip differently
between macOS and Windows. The first needs titles differing only in dropped punctuation; the
second only matters if the app ships beyond Windows.

## Predefined files

`PREDEFINED_FILES` is the lecture-dir contract: exactly these files get a tree entry, and a fresh
video upload wipes all of them (plus the side-files below) or none, since a file held open by a
viewer aborts the wipe before the first unlink. Anything else on disk is invisible to the
frontend. Adding a pipeline artifact means adding it here.

`original_summary.md` and `transcript.partial.meta.json` are deliberately outside the tuple —
the first is edit state read through the summary endpoint, the second is progress metadata
inlined as `transcribePartial` — but the video wipe takes both, since each describes the old video.
Materials are outside it too: they are a numbered family (below), not a fixed name.

## Materials

A lecture can hold any number of attached files of any extension, named `material.<ext>` (index 1),
`material.2.<ext>`, `material.3.<ext>`, … — `fs/paths.py` owns the pattern (`material_name` /
`material_index`) and `fs/materials.py` owns listing and allocation. No other service knows the
filename shape. `ext` is 1-5 lower-case alphanumerics and never all digits, so `material.2` is no
material. `POST …/materials?filename=` takes the disk ext from the original name's extension, else
`.pdf`; the original name is stored for display only and never used as a path.

A new material always takes **highest existing index + 1 across all extensions** (bare
`material.pdf` counts as 1), so a `.pdf` and a `.pptx` never share an index. Gaps left by deletes
are never reused and never backfilled: `material.pdf` + `material.3.pptx` allocates
`material.4.pdf`. A hand-made collision (`material.2.pdf` + `material.2.pptx`) lists sorted by
`(index, name)`. Deleting removes only the named file and never renames the rest,
because the frontend holds material URLs by name.

Allocation happens here, at write time, because a client that picked its own name would race
another uploader. It needs no lock: `write_material` scans the dir and writes with no `await`
in between, and the single async writer makes that pair atomic. Adding an `await` inside it,
serving `POST /…/materials` from a plain `def` (threadpool) route, or running a second uvicorn
worker each invalidate that and would put two uploads on one name.

A fresh `video.mp4` never touches materials: they are attached, not derived from the video, and a
handout routinely arrives before its recording.

A material may carry **meta** in `.materials.json`: `{material name: {source?, filename?, attach?}}`,
every key optional, an entry with no keys removed. `source` is the opaque string the downloader
passes as `?source=` (its discovery row's `ref`), never parsed here; `filename` is the original
name from `?filename=` (trimmed, capped at 255); `attach` is the user's boolean set through
`PATCH …/materials/{name}` and surfaced only when set. A legacy bare-string value reads as
`{"source": value}` (temporary, tracked in the repo-root `docs/MIGRATIONS.md`). The sidecar is read and written inside the same
no-`await` section as allocation. Deleting a material through the files route drops its entry; the
video wipe leaves the sidecar alone. Every sidecar writer is an `async def` route with no `await`
across its read-modify-write, so the event loop serialises them; a writer moved to a plain `def`
route would run in the threadpool and could drop another's entry. Writes go through a temp file and
`os.replace`, so the threadpool tree and listing reads never see a torn file. A source already carried by a material still appends a new file
— re-downloading is the user's call.

Legacy adoption, temporary (removal tracked in the repo-root `docs/MIGRATIONS.md`): a sourced POST
whose source no material carries yet first looks for a source-less material with identical bytes;
on a match it tags that file, writes nothing, and answers its name — so a PDF saved before sources
existed is not duplicated.

## Dotfiles

Metadata is stored as dotfiles so it stays invisible to listings: tree iteration walks
directories only, and the overview listing skips dot-prefixed names. They also survive renames,
since a rename moves the containing directory. None of them may ever become a tree row.

| File                     | Where       | Holds                                                    |
| ------------------------ | ----------- | -------------------------------------------------------- |
| `.archived`              | course dir  | empty marker; course is archived                          |
| `.lectures_only`         | course dir  | empty marker; picked as lectures-only, counted only under `lectures_some` ([SETTINGS.md](SETTINGS.md)) |
| `.source_url`            | course dir  | the auto-downloader's lecture-site URL for the course     |
| `.done`                  | lecture dir | empty marker; the user studied it — a fresh video upload keeps it |
| `.materials.json`        | lecture dir | `{material name: {source?, filename?, attach?}}` per-material meta |
| `.assignment_files.json` | assignment dir | `{filename: source}` (opaque string) for files written with a source |
| `.summary_materials.json` | lecture dir | `{"materials": [...]}` — the materials attached at the last Summarize (the run that wrote the current `summary.md`), including attached files it skipped; `[]` = nothing attached |
| `.pdf_warning`           | lecture dir | one line of LaTeX warning text for `summary.pdf`        |
| `.pdf_build.tex`         | lecture dir | generated LaTeX, kept by the backend only on a hard fail  |
| `.{slug}.pdf_warning`    | overview/   | same, per overview pdf (see OVERVIEW.md)                  |

Deleting `summary.pdf` drops both of its render markers — each describes that one build and can never outlive it.
`.summary_materials.json` follows `summary.md` the same way: deleting `summary.md` or a new `video.mp4` removes it; editing or reverting the summary text keeps it, and a fresh (re-summarize) write drops it until the backend records the new run.

## Removed intermediates

`REMOVABLE_FILES` (`video.mp4`, `audio.mp3`) are the only files `POST /…/removed` will delete; when to
call it is the backend's policy, not checked here. Summaries, the pdf, `drive_url.txt`, `transcript.txt` (search reads it) and materials never are.

Nothing records a removal: the tree derives it from the files, so a file the user deleted by hand reads
exactly like one the app removed. Because `transcript.txt` is never removed, a later artifact proves an
absent intermediate once existed:

- `video.mp4` is removed iff it is absent and `audio.mp3` or `transcript.txt` exists.
- `audio.mp3` is removed iff it is absent and `transcript.txt` exists.

A materials-only lecture has neither, so it reports nothing removed.

## Tree shape

`read_tree` returns one node per course: `name`, `archived`, `lectures_only`, `source_url`,
`lectures`, `recitations`, `assignments`. `lectures_only` is resolved, never raw: `course_structure == lectures_all`,
or `lectures_some` and the course has `.lectures_only` — consumers read only this flag, never the setting. `Recitations`, `Assignments` and `overview` are skipped as lectures.
`assignments` is always present (`[]` when none): `[{name, files: [{name, size, mtime[, source]}]}]`, both levels sorted by name, `source` omitted when absent, dotfiles never rows.

Each lecture entry carries `files` (every predefined name → `{exists, size, mtime}`),
`materials` (index-ordered `{name, size, mtime}` plus `source`, `filename` and `attach` when set, always present and `[]` when none — presence
in the list *is* existence, so entries carry no `exists`), `transcribePartial`, and `removed` (the
names derived above, in `REMOVABLE_FILES` order; always present, `[]` when none), `summaryMaterials` (`string[]` from `.summary_materials.json`, `null` when absent or unreadable), and `done` (`.done`
exists; always present, `false` when absent). Three fields are inlined onto file entries rather than exposed as separate
endpoints, because the frontend needs them on every render of the tree:

- `drive_url.txt` → `url` on its own entry.
- `.pdf_warning` → `warning` on the `summary.pdf` entry.
- `video.mp4`'s `moov/mvhd` box → `duration` (seconds, float) on its own entry, read on every tree
  read by `fs/mp4.py` with no cache; omitted while absent, still downloading (no `moov`), fragmented, duration-unknown, or unreadable.

**Absent, empty, or unreadable metadata means the key is omitted entirely — never `null`.**
Clients test key presence, so emitting `null` would read as "there is a warning".

`source_url` is the exception: it is always present, `null` when unset, so courses predating the
field stay backwards-compatible.

## Degrade, don't fail

Every metadata read (`transcript.partial.meta.json`, both `.pdf_warning` readers,
`overview/meta.json`, `.materials.json`) swallows parse and read errors and falls back to "absent". A corrupt
side-file must never take down a whole tree or listing; the next write self-heals it.
Writing `.materials.json` degrades the same way: a failed write is logged and the upload or delete still succeeds, untagged. The one exception is `PATCH …/materials/{name}`: the flag lives only in the sidecar, so a failed write answers `500 file_write_failed` and does not notify.

## Assignments

A named folder of files under `Assignments/`, created on demand (the course dir must exist, else `404` `course_not_found`). The
folder name goes through `safe_name()`; a file name goes through `check_safe_segment()` then the same NTFS cleanup (illegal chars dropped, trailing dots/spaces stripped, `CON.pdf` → `CON_.pdf`, extension kept); a leading dot is
refused on POST and GET (dotfiles are sidecars). A taken name allocates `stem (2).ext`, `stem (3).ext`, … in `fs/assignments.py`, scan and write
with no `await`, like materials; `POST` answers the effective assignment and file names. `.assignment_files.json` shares the
`.materials.json` atomic read/write primitives: unreadable reads as `{}`, a failed write is logged and the upload still succeeds.
