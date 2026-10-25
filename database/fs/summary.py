import json
import os
from pathlib import Path

from .paths import (
    SUMMARY_MATERIALS_MARKER,
    CodedValueError,
    LectureNotFound,
    check_none_locked,
    lecture_dir,
    reject_if_locked,
)


def _paths(course: str, lecture: str, kind: str):
    """Return (summary.md, original_summary.md) paths for the lecture."""

    d = lecture_dir(course, lecture, kind)
    return d / "summary.md", d / "original_summary.md"


def read_summary(course: str, lecture: str, kind: str) -> dict:
    """Return the current summary content plus whether an untouched original is preserved."""

    summary_path, original_path = _paths(course, lecture, kind)
    content = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
    return {"content": content, "hasOriginal": original_path.exists()}


def write_summary(
    course: str, lecture: str, kind: str, content: str, fresh: bool = False
) -> None:
    """Write the summary, preserving the pre-edit version as original_summary.md on the first edit so revert works later."""

    # fresh marks new pipeline output: any snapshot describes a summary it replaces, so it goes.
    summary_path, original_path = _paths(course, lecture, kind)
    try:
        if fresh:
            # Probe both first, so a lock on summary.md cannot leave the snapshot deleted and the write undone.
            check_none_locked((summary_path, original_path))
            try:
                original_path.unlink(missing_ok=True)
            except PermissionError as e:
                reject_if_locked(e, original_path.name)
                raise
            # The record names the run that wrote the old text; the backend re-PUTs it after this write.
            (summary_path.parent / SUMMARY_MATERIALS_MARKER).unlink(missing_ok=True)
        elif not original_path.exists() and summary_path.exists():
            summary_path.rename(original_path)
        summary_path.write_text(content, encoding="utf-8")
    except FileNotFoundError:
        # No mkdir here: a summary landing after its lecture was deleted must not resurrect it.
        if summary_path.parent.is_dir():
            raise
        raise LectureNotFound(
            f"{course}/{lecture} does not exist", course=course, lecture=lecture
        ) from None
    except PermissionError as e:
        # Past the snapshot unlink only summary.md is touched: the rename's source and the write's target.
        reject_if_locked(e, summary_path.name)
        raise


def revert_summary(course: str, lecture: str, kind: str) -> None:
    """Restore summary.md from original_summary.md and drop the original marker; no-op if no original exists."""

    summary_path, original_path = _paths(course, lecture, kind)
    if not original_path.exists():
        return
    try:
        original = original_path.read_bytes()
    except PermissionError as e:
        reject_if_locked(e, original_path.name)
        raise
    try:
        summary_path.write_bytes(original)
    except PermissionError as e:
        reject_if_locked(e, summary_path.name)
        raise
    try:
        original_path.unlink()
    except PermissionError as e:
        reject_if_locked(e, original_path.name)
        raise


def read_summary_materials(d: Path) -> list[str] | None:
    """Return the material names the current summary.md was built from, or None when absent or unreadable."""

    try:
        raw = json.loads((d / SUMMARY_MATERIALS_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    names = raw.get("materials") if isinstance(raw, dict) else None
    if isinstance(names, list) and all(isinstance(n, str) for n in names):
        return names
    return None


def write_summary_materials(course: str, lecture: str, kind: str, names) -> None:
    """Atomically record the material names sent to Gemini for the current summary; no mkdir, so a gone lecture 404s."""

    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise CodedValueError(
            "materials must be a list of strings",
            "bad_request_body",
            detail="materials must be a list of strings",
        )
    d = lecture_dir(course, lecture, kind)
    if not d.is_dir():
        raise LectureNotFound(
            f"{course}/{lecture} does not exist", course=course, lecture=lecture
        )
    # Swap in a whole file: the threadpool tree reads concurrently, and a torn read degrades to null.
    tmp = d / (SUMMARY_MATERIALS_MARKER + ".tmp")
    tmp.write_text(
        json.dumps({"materials": names}, ensure_ascii=False), encoding="utf-8"
    )
    try:
        os.replace(tmp, d / SUMMARY_MATERIALS_MARKER)
    except PermissionError as e:
        reject_if_locked(e, SUMMARY_MATERIALS_MARKER)
        raise
