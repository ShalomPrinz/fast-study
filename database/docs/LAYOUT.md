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

## Predefined files

`PREDEFINED_FILES` is the lecture-dir contract: exactly these files get a tree entry, and
exactly these get wiped on a fresh video upload. Anything else on disk is invisible to the
frontend. Adding a pipeline artifact means adding it here.

`original_summary.md` and `transcript.partial.meta.json` are deliberately outside the tuple —
the first is edit state read through the summary endpoint, the second is progress metadata
inlined as `transcribePartial`.

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

## Tree shape

`read_tree` returns one node per course: `name`, `archived`, `source_url`, `lectures`,
`recitations`. `Recitations` and `overview` are skipped as lectures.

Each lecture entry carries `files` (every predefined name → `{exists, size, mtime}`) plus
`transcribePartial`. Two fields are inlined onto file entries rather than exposed as separate
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
