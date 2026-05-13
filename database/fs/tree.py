import json
from pathlib import Path
from typing import Optional

from .paths import data_root, RECITATIONS_DIR, PREDEFINED_FILES


def _read_transcribe_partial(lecture_path: Path) -> Optional[dict]:
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


def _read_lecture(lecture_path: Path, name: str) -> dict:
    files = {}
    for f in PREDEFINED_FILES:
        p = lecture_path / f
        exists = p.exists()
        size = p.stat().st_size if exists else None
        url = None
        if f == "drive_url.txt" and exists:
            url = p.read_text(encoding="utf-8").strip()
        entry = {"exists": exists, "size": size}
        if url is not None:
            entry["url"] = url
        files[f] = entry
    return {
        "name": name,
        "files": files,
        "transcribePartial": _read_transcribe_partial(lecture_path),
    }


def _read_lectures(course_path: Path) -> list[dict]:
    if not course_path.exists():
        return []
    return [
        _read_lecture(course_path / entry.name, entry.name)
        for entry in course_path.iterdir()
        if entry.is_dir() and entry.name != RECITATIONS_DIR
    ]


def _read_recitations(course_path: Path) -> list[dict]:
    rec_dir = course_path / RECITATIONS_DIR
    if not rec_dir.exists():
        return []
    return [
        _read_lecture(rec_dir / entry.name, entry.name)
        for entry in rec_dir.iterdir()
        if entry.is_dir()
    ]


def read_course(name: str) -> Optional[dict]:
    course_path = data_root() / name
    if not course_path.exists():
        return None
    return {
        "name": name,
        "lectures": _read_lectures(course_path),
        "recitations": _read_recitations(course_path),
    }


def read_tree() -> list[dict]:
    root = data_root()
    if not root.exists():
        return []
    return [c for c in (read_course(e.name) for e in root.iterdir() if e.is_dir()) if c is not None]
