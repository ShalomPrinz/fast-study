import json
import os
from pathlib import Path

from .paths import course_dir, overview_dir

OVERVIEW_META = "meta.json"


def _check_safe(segment: str) -> None:
    """Reject a course/file name that could escape its directory (path separators or '..')."""

    if (
        not segment
        or segment in (".", "..")
        or "/" in segment
        or "\\" in segment
        or "\x00" in segment
    ):
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


def read_overview_meta(course: str) -> dict:
    """Return the per-extractor course overview meta map, or {} when absent or unparseable."""

    _check_safe(course)
    meta_path = overview_dir(course) / OVERVIEW_META
    if not meta_path.exists():
        return {}

    # defined as not critical - so we swallow any errors
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def merge_overview_meta(course: str, slug: str, entry) -> None:
    """Set meta[slug]=entry in the course's overview meta.json, creating overview/ on demand."""

    # we avoid using await here to achieve atomicity
    _check_safe(course)
    _check_safe(slug)
    if not course_dir(course).is_dir():
        raise FileNotFoundError(f"course not found: {course}")
    d = overview_dir(course)
    d.mkdir(exist_ok=True)
    meta_path = d / OVERVIEW_META
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    else:
        meta = {}

    meta[slug] = entry
    # Atomic write using os.replace, instead of truncate then write (not atomic)
    tmp_path = meta_path.with_name(f"{meta_path.name}.{os.getpid()}.tmp")
    tmp_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(tmp_path, meta_path)
