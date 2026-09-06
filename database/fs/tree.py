import json
from pathlib import Path
from typing import Optional

from .materials import list_materials
from .paths import (
    ARCHIVED_MARKER,
    OVERVIEW_DIR,
    PDF_WARNING_MARKER,
    PREDEFINED_FILES,
    RECITATIONS_DIR,
    SOURCE_URL_MARKER,
    data_root,
)


def _read_transcribe_partial(lecture_path: Path) -> Optional[dict]:
    """Return partial-transcription progress {completed, total}, or None if absent or malformed."""

    meta_path = lecture_path / "transcript.partial.meta.json"
    if not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        completed = meta.get("completed_chunks")
        total = meta.get("total_chunks")
        if isinstance(completed, int) and isinstance(total, int):
            return {"completed": completed, "total": total}
        return None
    except Exception:
        return None


def _read_pdf_warning(lecture_path: Path) -> Optional[str]:
    """Return the non-fatal LaTeX warning for summary.pdf, or None if absent, empty, or unreadable."""

    p = lecture_path / PDF_WARNING_MARKER
    if not p.exists():
        return None
    try:
        return p.read_text(encoding="utf-8").strip() or None
    except Exception:
        return None


def _read_lecture(lecture_path: Path, name: str) -> dict:
    """Build the tree entry for one lecture: existence/size per predefined file, the material list,
    and partial-transcript progress."""

    files = {}
    for f in PREDEFINED_FILES:
        p = lecture_path / f
        exists = p.exists()
        stat = p.stat() if exists else None
        size = stat.st_size if stat else None
        mtime = stat.st_mtime if stat else None
        url = None
        if f == "drive_url.txt" and exists:
            url = p.read_text(encoding="utf-8").strip()
        entry = {"exists": exists, "size": size, "mtime": mtime}
        if url is not None:
            entry["url"] = url
        if f == "summary.pdf":
            warning = _read_pdf_warning(lecture_path)
            if warning is not None:
                entry["warning"] = warning
        files[f] = entry
    return {
        "name": name,
        "files": files,
        "materials": list_materials(lecture_path),
        "transcribePartial": _read_transcribe_partial(lecture_path),
    }


def _read_lectures(course_path: Path) -> list[dict]:
    """List lecture entries directly under a course dir, skipping the Recitations and overview folders."""

    if not course_path.exists():
        return []
    return [
        _read_lecture(course_path / entry.name, entry.name)
        for entry in course_path.iterdir()
        if entry.is_dir() and entry.name not in (RECITATIONS_DIR, OVERVIEW_DIR)
    ]


def _read_recitations(course_path: Path) -> list[dict]:
    """List recitation entries from the course's Recitations subdirectory."""

    rec_dir = course_path / RECITATIONS_DIR
    if not rec_dir.exists():
        return []
    return [
        _read_lecture(rec_dir / entry.name, entry.name)
        for entry in rec_dir.iterdir()
        if entry.is_dir()
    ]


def _read_source_url(course_path: Path) -> Optional[str]:
    """Return the course's source URL, or None when unset (backwards-compatible for pre-existing courses)."""

    p = course_path / SOURCE_URL_MARKER
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8").strip() or None


def read_course(name: str) -> Optional[dict]:
    """Return the full tree for a single course (lectures + recitations), or None if it doesn't exist."""

    course_path = data_root() / name
    if not course_path.exists():
        return None
    return {
        "name": name,
        "archived": (course_path / ARCHIVED_MARKER).exists(),
        "source_url": _read_source_url(course_path),
        "lectures": _read_lectures(course_path),
        "recitations": _read_recitations(course_path),
    }


def read_tree() -> list[dict]:
    """Return every course under DATA_ROOT with its lecture and recitation tree."""

    root = data_root()
    if not root.exists():
        return []
    return [
        c
        for c in (read_course(e.name) for e in root.iterdir() if e.is_dir())
        if c is not None
    ]
