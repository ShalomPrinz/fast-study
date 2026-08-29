# LAYOUT — on-disk conventions

This service is the single source of truth for the `DATA_ROOT` layout. Other services never
build paths; they pass `(course, lecture, kind)` and let `fs/paths.py` resolve them.

```
{DATA_ROOT}/{course}/{lecture}/...              lectures
{DATA_ROOT}/{course}/Recitations/{name}/...     recitations
{DATA_ROOT}/{course}/overview/...               course-level files (see OVERVIEW.md)
```

`lecture_dir(course, lecture, kind)` is the only resolver — `kind="recitation"` inserts the
`Recitations` level. Re-encoding this layout anywhere else (here or in another service) is the
one thing that breaks the arrangement.

Every resolver runs course and lecture names through `safe_name()` first (below).

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
| Reserve | `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` take a `_` suffix — reserved with an extension too, so `CON.txt` is refused |
| Reject  | A name with nothing legal left raises, surfacing as a `400`                              |

Illegal characters are dropped rather than substituted because a separator would have to be a legal
character, so it becomes visible punctuation the user never typed — and the common case is a colon
or slash already sitting beside a space, where a replacement stacks a separator against that space
and reads worse than the gap dropping leaves. Dropping is also trivially idempotent, which the
resolvers depend on; a replacement rule has to be written carefully not to collapse runs differently
on a second pass. This is deliberately not exposed as a setting: reversing it is a migration once
directories exist on disk, not a config change.

The rule is idempotent, which is what the arrangement rests on: a name read back off disk
resolves to itself, so renames and tree round-trips are stable. `read_course` takes its name
straight from the `iterdir()` walk and is the one place that deliberately skips sanitizing.

Sanitization is silent — create and rename still return `204`. The effective name reaches the
user through the tree, which lists real directory names and refreshes over SSE immediately.

Two cases are knowingly unhandled: two names in one course that sanitize identically merge into
one directory, and no Unicode normalization happens, so a name could round-trip differently
between macOS and Windows. The first needs titles differing only in dropped punctuation; the
second only matters if the app ships beyond Windows.

## Predefined files

`PREDEFINED_FILES` is the lecture-dir contract: exactly these files get a tree entry, and
exactly these get wiped on a fresh video upload. Anything else on disk is invisible to the
frontend. Adding a pipeline artifact means adding it here.

`original_summary.md` and `transcript.partial.meta.json` are deliberately outside the tuple —
the first is edit state read through the summary endpoint, the second is progress metadata
inlined as `transcribePartial`. Material PDFs are outside it too: they are a numbered family
(below), not a fixed name.

## Materials

A lecture can hold any number of attached PDFs, named `material.pdf`, `material.2.pdf`,
`material.3.pdf`, … — `fs/paths.py` owns the pattern (`material_name` / `material_index`) and
`fs/materials.py` owns listing and allocation. No other service knows the filename shape.

A new material always takes **highest existing index + 1** (bare `material.pdf` counts as 1).
Gaps left by deletes are never reused and never backfilled: `material.pdf` + `material.3.pdf`
allocates `material.4.pdf`. Deleting removes only the named file and never renames the rest,
because the frontend holds material URLs by name.

Allocation happens here, at write time, because a client that picked its own name would race
another uploader. It needs no lock: `write_material` scans the dir and writes with no `await`
in between, and the single async writer makes that pair atomic. Adding an `await` inside it,
serving `POST /…/materials` from a plain `def` (threadpool) route, or running a second uvicorn
worker each invalidate that and would put two uploads on one name.

A fresh `video.mp4` wipes every material along with the derived artifacts: a new video means the
lecture folder is being re-sourced from scratch, so a re-upload is a reset, not an append.

## Dotfiles

Metadata is stored as dotfiles so it stays invisible to listings: tree iteration walks
directories only, and the overview listing skips dot-prefixed names. They also survive renames,
since a rename moves the containing directory. None of them may ever become a tree row.

| File                     | Where       | Holds                                                    |
| ------------------------ | ----------- | -------------------------------------------------------- |
| `.archived`              | course dir  | empty marker; course is archived                          |
| `.source_url`            | course dir  | the auto-downloader's lecture-site URL for the course     |
| `.pdf_warning`           | lecture dir | one line of XeLaTeX warning text for `summary.pdf`        |
| `.pdf_build.tex`         | lecture dir | generated LaTeX, kept by the backend only on a hard fail  |
| `.{slug}.pdf_warning`    | overview/   | same, per overview pdf (see OVERVIEW.md)                  |

Deleting `summary.pdf` drops both of its render markers — each describes that one build and can never outlive it.

## Tree shape

`read_tree` returns one node per course: `name`, `archived`, `source_url`, `lectures`,
`recitations`. `Recitations` and `overview` are skipped as lectures.

Each lecture entry carries `files` (every predefined name → `{exists, size, mtime}`),
`materials` (index-ordered `{name, size, mtime}`, always present and `[]` when none — presence
in the list *is* existence, so entries carry no `exists`), and `transcribePartial`. Two fields are inlined onto file entries rather than exposed as separate
endpoints, because the frontend needs them on every render of the tree:

- `drive_url.txt` → `url` on its own entry.
- `.pdf_warning` → `warning` on the `summary.pdf` entry.

**Absent, empty, or unreadable metadata means the key is omitted entirely — never `null`.**
Clients test key presence, so emitting `null` would read as "there is a warning".

`source_url` is the exception: it is always present, `null` when unset, so courses predating the
field stay backwards-compatible.

## Degrade, don't fail

Every metadata read (`transcript.partial.meta.json`, both `.pdf_warning` readers,
`overview/meta.json`) swallows parse and read errors and falls back to "absent". A corrupt
side-file must never take down a whole tree or listing; the next write self-heals it.
