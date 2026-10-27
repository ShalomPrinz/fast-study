import os
from pathlib import Path

from .material_meta import read_json_dict, write_json_dict
from .paths import (
    ASSIGNMENT_DOCS,
    ASSIGNMENT_FILES_MARKER,
    ASSIGNMENT_META_MARKER,
    ASSIGNMENTS_DIR,
    DONE_MARKER,
    GENERATED_DIR,
    ILLEGAL_NAME_CHARS,
    OVERVIEW_DIR,
    PDF_BUILD_TEX_MARKER,
    PDF_WARNING_MARKER,
    RECITATIONS_DIR,
    AssignmentFileNotFound,
    CodedValueError,
    CourseNotFound,
    LectureNotFound,
    assignment_dir,
    check_safe_segment,
    course_dir,
    defuse_reserved,
    lecture_dir,
    reject_if_locked,
)
from .summary import restore_snapshot, write_snapshotted

_KINDS = ("lecture", "recitation")


def _read_sources(d: Path) -> dict[str, str]:
    """Read an assignment's {filename: source} map, keeping only non-empty string pairs."""

    return {
        k: v
        for k, v in read_json_dict(d, ASSIGNMENT_FILES_MARKER).items()
        if isinstance(v, str) and v
    }


def _free_name(d: Path, filename: str) -> str:
    """Return filename, or `stem (N).ext` for the lowest N >= 2 not taken in the dir."""

    if not (d / filename).exists():
        return filename
    stem, ext = os.path.splitext(filename)
    n = 2
    while (d / f"{stem} ({n}){ext}").exists():
        n += 1
    return f"{stem} ({n}){ext}"


def _legal_filename(filename: str) -> str:
    """Make an uploaded name legal on NTFS like safe_name() does for folders, keeping the extension."""

    check_safe_segment(filename)
    cleaned = "".join(c for c in filename if c not in ILLEGAL_NAME_CHARS).strip()
    # Windows silently strips trailing dots and spaces, which would desync the name from disk.
    cleaned = cleaned.rstrip(". ")
    cleaned = defuse_reserved(cleaned)
    # Dotfiles are sidecars, never rows: refusing a leading dot also keeps an upload off the marker.
    if not cleaned or cleaned.startswith("."):
        raise CodedValueError(
            f"unsafe path segment: {filename!r}",
            "unsafe_path_segment",
            segment=filename,
        )
    return cleaned


def write_assignment_file(
    course: str, name: str, filename: str, data: bytes, source: str | None = None
) -> tuple[str, str]:
    """Save a file in an assignment under a collision-free name, record its source, return (assignment, file) as written."""

    filename = _legal_filename(filename)
    # The course is never created here: an upload finishing after a rename would recreate a ghost course.
    if not course_dir(course).is_dir():
        raise CourseNotFound(f"course not found: {course}", course=course)
    d = assignment_dir(course, name)
    d.mkdir(parents=True, exist_ok=True)
    # No await between scan and write is what makes allocation lock-free — see docs/LAYOUT.md.
    effective = _free_name(d, filename)
    (d / effective).write_bytes(data)
    sources = _read_sources(d)
    # A stale entry left by a file removed outside the API must not mislabel the new one.
    stale = sources.pop(effective, None)
    if source:
        sources[effective] = source
    if source or stale is not None:
        write_json_dict(d, ASSIGNMENT_FILES_MARKER, sources)
    return d.name, effective


def _read_attach(d: Path) -> dict[str, bool]:
    """Read the {file: False} switch map; only `false` values count, anything else reads as attached."""

    raw = read_json_dict(d, ASSIGNMENT_META_MARKER).get("attach")
    if not isinstance(raw, dict):
        return {}
    return {k: False for k, v in raw.items() if v is False}


def _read_lectures(d: Path) -> list[dict]:
    """Read the stored course-material selection, keeping only well-formed {name, kind} entries."""

    raw = read_json_dict(d, ASSIGNMENT_META_MARKER).get("lectures")
    if not isinstance(raw, list):
        return []
    return [
        {"name": e["name"], "kind": e["kind"]}
        for e in raw
        if isinstance(e, dict)
        and isinstance(e.get("name"), str)
        and e.get("kind") in _KINDS
    ]


def _lecture_exists(course_path: Path, entry: dict) -> bool:
    """Tell whether a selected lecture or recitation is still a folder of its course."""

    name = entry["name"]
    if name in (RECITATIONS_DIR, OVERVIEW_DIR, ASSIGNMENTS_DIR):
        return False
    try:
        return lecture_dir(course_path.name, name, entry["kind"]).is_dir()
    except CodedValueError:
        return False


def _read_doc(g: Path, doc: str) -> dict | None:
    """Build one doc's tree entry {md_mtime, pdf_mtime, pdf_warning}, or None while there is no {doc}.md."""

    try:
        md = (g / f"{doc}.md").stat().st_mtime
    except OSError:
        return None
    try:
        pdf = (g / f"{doc}.pdf").stat().st_mtime
    except OSError:
        pdf = None
    try:
        warning = (g / f"{doc}{PDF_WARNING_MARKER}").read_text(encoding="utf-8").strip()
    except OSError:
        warning = ""
    return {"md_mtime": md, "pdf_mtime": pdf, "pdf_warning": warning or None}


def _is_junk_name(name: str) -> bool:
    """True for names the file list hides: dotfiles, Office `~$` owner files, `*.tmp`, Thumbs.db, desktop.ini."""

    return (
        name.startswith((".", "~$"))
        or name.lower().endswith(".tmp")
        or name.lower() in ("thumbs.db", "desktop.ini")
    )


def list_assignments(course_path: Path) -> list[dict]:
    """Build the tree's assignments list: {name, done, files, lectures, docs}, both levels sorted by name."""

    root = course_path / ASSIGNMENTS_DIR
    if not root.is_dir():
        return []
    out = []
    for a in sorted(p for p in root.iterdir() if p.is_dir()):
        sources = _read_sources(a)
        detached = _read_attach(a)
        files = []
        for f in sorted(a.iterdir()):
            if _is_junk_name(f.name) or not f.is_file():
                continue
            try:
                st = f.stat()
            except OSError:
                # Deleted between listing and stat — treat as absent rather than failing the tree.
                continue
            entry = {"name": f.name, "size": st.st_size, "mtime": st.st_mtime}
            if f.name in sources:
                entry["source"] = sources[f.name]
            entry["attach"] = f.name not in detached
            files.append(entry)
        out.append(
            {
                "name": a.name,
                "done": (a / DONE_MARKER).exists(),
                "files": files,
                "lectures": [
                    e for e in _read_lectures(a) if _lecture_exists(course_path, e)
                ],
                "docs": {
                    doc: _read_doc(a / GENERATED_DIR, doc) for doc in ASSIGNMENT_DOCS
                },
            }
        )
    return out


def _existing_dir(course: str, name: str) -> Path:
    """Resolve an assignment's dir, raising LectureNotFound when it is gone so no write recreates it."""

    d = assignment_dir(course, name)
    if not d.is_dir():
        raise LectureNotFound(
            f"{course}/{name} does not exist", course=course, lecture=name
        )
    return d


def _write_meta(d: Path, attach: dict, lectures: list) -> None:
    """Persist the meta sidecar atomically, omitting empty keys; a failed write raises."""

    data = {}
    if attach:
        data["attach"] = attach
    if lectures:
        data["lectures"] = lectures
    try:
        write_json_dict(d, ASSIGNMENT_META_MARKER, data, strict=True)
    except PermissionError as e:
        reject_if_locked(e, ASSIGNMENT_META_MARKER)
        raise


def set_file_attach(course: str, name: str, file: str, attach) -> None:
    """Record whether an assignment file goes to Gemini; only `false` is stored, `true` clears the key."""

    if not isinstance(attach, bool):
        raise CodedValueError(
            "attach must be a boolean",
            "bad_request_body",
            detail="attach must be a boolean",
        )
    d = _existing_dir(course, name)
    if not assignment_file_path(course, name, file).is_file():
        raise AssignmentFileNotFound(f"{file} not found", file=file)
    detached = _read_attach(d)
    if attach:
        detached.pop(file, None)
    else:
        detached[file] = False
    _write_meta(d, detached, _read_lectures(d))


def set_lectures(course: str, name: str, lectures) -> None:
    """Replace the course-material selection with [{name, kind}], kept in the given order."""

    ok = isinstance(lectures, list) and all(
        isinstance(e, dict)
        and isinstance(e.get("name"), str)
        and e.get("kind") in _KINDS
        for e in lectures
    )
    if not ok:
        raise CodedValueError(
            "lectures must be a list of {name, kind}",
            "bad_request_body",
            detail="lectures must be a list of {name, kind}",
        )
    d = _existing_dir(course, name)
    _write_meta(
        d, _read_attach(d), [{"name": e["name"], "kind": e["kind"]} for e in lectures]
    )


def _mkdir_generated(g: Path, course: str, name: str) -> None:
    """Create .generated/ without its parent; a dir that vanished since _existing_dir is LectureNotFound."""

    try:
        g.mkdir(exist_ok=True)
    except FileNotFoundError:
        raise LectureNotFound(
            f"{course}/{name} does not exist", course=course, lecture=name
        ) from None


def _doc_paths(course: str, name: str, doc: str) -> tuple[Path, Path]:
    """Return ({doc}.md, original_{doc}.md) under .generated; an unknown doc id is file_not_found."""

    if doc not in ASSIGNMENT_DOCS:
        raise AssignmentFileNotFound(f"unknown doc: {doc}", file=doc)
    g = assignment_dir(course, name) / GENERATED_DIR
    return g / f"{doc}.md", g / f"original_{doc}.md"


def read_doc(course: str, name: str, doc: str) -> dict:
    """Return a generated doc's {content, hasOriginal}; file_not_found while there is no {doc}.md."""

    md, original = _doc_paths(course, name, doc)
    try:
        content = md.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise AssignmentFileNotFound(f"{md.name} not found", file=md.name) from None
    return {"content": content, "hasOriginal": original.exists()}


def write_doc(course: str, name: str, doc: str, content: str, fresh: bool) -> None:
    """Write {doc}.md under the summary snapshot rules; creates .generated/ but never the assignment."""

    md, original = _doc_paths(course, name, doc)
    _existing_dir(course, name)
    _mkdir_generated(md.parent, course, name)
    try:
        write_snapshotted(md, original, content, fresh)
    except FileNotFoundError:
        raise LectureNotFound(
            f"{course}/{name} does not exist", course=course, lecture=name
        ) from None


def revert_doc(course: str, name: str, doc: str) -> None:
    """Restore {doc}.md from its snapshot; no-op without one."""

    md, original = _doc_paths(course, name, doc)
    _existing_dir(course, name)
    restore_snapshot(md, original)


def _generated_names() -> set[str]:
    """The whitelist of .generated/ files the bytes routes address."""

    return {
        f"{doc}{ext}"
        for doc in ASSIGNMENT_DOCS
        for ext in (".pdf", PDF_WARNING_MARKER, PDF_BUILD_TEX_MARKER)
    }


def generated_path(course: str, name: str, file: str) -> Path:
    """Resolve a whitelisted .generated/ file; any other name is refused unsafe_path_segment."""

    if file not in _generated_names():
        raise CodedValueError(
            f"unsafe path segment: {file!r}", "unsafe_path_segment", segment=file
        )
    return assignment_dir(course, name) / GENERATED_DIR / file


def write_generated(course: str, name: str, file: str, data: bytes) -> None:
    """Write one whitelisted .generated/ file; creates the folder but never the assignment."""

    p = generated_path(course, name, file)
    _existing_dir(course, name)
    _mkdir_generated(p.parent, course, name)
    try:
        p.write_bytes(data)
    except FileNotFoundError:
        raise LectureNotFound(
            f"{course}/{name} does not exist", course=course, lecture=name
        ) from None
    except PermissionError as e:
        reject_if_locked(e, file)
        raise


def delete_generated(course: str, name: str, file: str) -> None:
    """Delete one whitelisted .generated/ file (absent is a no-op); a pdf takes its warning with it."""

    p = generated_path(course, name, file)
    targets = [p]
    if file.endswith(".pdf"):
        targets.append(p.with_name(file + "_warning"))
    for target in targets:
        try:
            target.unlink(missing_ok=True)
        except PermissionError as e:
            reject_if_locked(e, target.name)
            raise


def set_assignment_done(course: str, name: str, done: bool) -> None:
    """Create or remove the .done marker in an assignment dir (idempotent); LectureNotFound if the dir is gone."""

    d = assignment_dir(course, name)
    if not d.is_dir():
        raise LectureNotFound(
            f"{course}/{name} does not exist", course=course, lecture=name
        )
    marker = d / DONE_MARKER
    if done:
        marker.touch(exist_ok=True)
    else:
        marker.unlink(missing_ok=True)


def assignment_file_path(course: str, name: str, file: str) -> Path:
    """Resolve an assignment file's path, refusing a name that could escape its folder."""

    check_safe_segment(file)
    if file.startswith("."):
        raise CodedValueError(
            f"unsafe path segment: {file!r}", "unsafe_path_segment", segment=file
        )
    return assignment_dir(course, name) / file
