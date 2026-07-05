from pathlib import Path

from .paths import course_dir, overview_dir


def _check_safe(segment: str) -> None:
    """Reject a course/file name that could escape its directory (path separators or '..')."""

    if not segment or segment in (".", "..") or "/" in segment or "\\" in segment or "\x00" in segment:
        raise ValueError(f"unsafe path segment: {segment!r}")


def overview_file_path(course: str, name: str) -> Path:
    """Resolve the on-disk path for a single file inside a course's overview directory."""

    _check_safe(course)
    _check_safe(name)
    return overview_dir(course) / name


def write_overview_file(course: str, name: str, data: bytes) -> None:
    """Write raw bytes to a course-level overview file, creating overview/ on demand."""

    p = overview_file_path(course, name)
    if not course_dir(course).is_dir():
        raise FileNotFoundError(f"course not found: {course}")
    p.parent.mkdir(exist_ok=True)
    p.write_bytes(data)


def list_overview_files(course: str) -> list[dict]:
    """List {name, size, mtime} entries in a course's overview dir; empty if it doesn't exist yet."""

    _check_safe(course)
    d = overview_dir(course)
    if not d.is_dir():
        return []
    entries = []
    for p in sorted(d.iterdir()):
        if not p.is_file():
            continue
        stat = p.stat()
        entries.append({"name": p.name, "size": stat.st_size, "mtime": stat.st_mtime})
    return entries
