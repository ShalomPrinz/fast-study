from pathlib import Path

from .paths import OVERVIEW_DIR, RECITATIONS_DIR, course_dir, lecture_dir


def _read_summary(course: str, name: str, kind: str) -> dict | None:
    """Return a {name, kind, content} entry for one lecture/recitation, or None when its summary.md is missing or empty."""

    p = lecture_dir(course, name, kind) / "summary.md"
    if not p.is_file():
        return None
    content = p.read_text(encoding="utf-8")
    return {"name": name, "kind": kind, "content": content} if content else None


def _entry_names(d: Path, skip: tuple[str, ...] = ()) -> list[str]:
    """List subdirectory names under a directory, skipping the given names; empty if the dir is absent."""

    if not d.is_dir():
        return []
    return sorted(e.name for e in d.iterdir() if e.is_dir() and e.name not in skip)


def read_course_summaries(course: str) -> list[dict]:
    """Return every non-empty summary.md in a course (lectures + recitations)."""

    root = course_dir(course)
    if not root.is_dir():
        raise FileNotFoundError(f"course not found: {course}")
    names = [
        (n, "lecture") for n in _entry_names(root, (RECITATIONS_DIR, OVERVIEW_DIR))
    ] + [(n, "recitation") for n in _entry_names(root / RECITATIONS_DIR)]
    return [
        e
        for e in (_read_summary(course, n, kind) for n, kind in names)
        if e is not None
    ]
