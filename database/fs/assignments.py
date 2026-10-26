import os
from pathlib import Path

from .material_meta import read_json_dict, write_json_dict
from .paths import (
    ASSIGNMENT_FILES_MARKER,
    ASSIGNMENTS_DIR,
    DONE_MARKER,
    ILLEGAL_NAME_CHARS,
    CodedValueError,
    CourseNotFound,
    LectureNotFound,
    assignment_dir,
    check_safe_segment,
    course_dir,
    defuse_reserved,
)


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


def list_assignments(course_path: Path) -> list[dict]:
    """Build the tree's assignments list: {name, done, files: [{name, size, mtime[, source]}]}, both sorted by name."""

    root = course_path / ASSIGNMENTS_DIR
    if not root.is_dir():
        return []
    out = []
    for a in sorted(p for p in root.iterdir() if p.is_dir()):
        sources = _read_sources(a)
        files = []
        for f in sorted(a.iterdir()):
            if f.name.startswith(".") or not f.is_file():
                continue
            try:
                st = f.stat()
            except OSError:
                # Deleted between listing and stat — treat as absent rather than failing the tree.
                continue
            entry = {"name": f.name, "size": st.st_size, "mtime": st.st_mtime}
            if f.name in sources:
                entry["source"] = sources[f.name]
            files.append(entry)
        out.append({"name": a.name, "done": (a / DONE_MARKER).exists(), "files": files})
    return out


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
