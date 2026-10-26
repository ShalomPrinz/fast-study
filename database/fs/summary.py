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


def write_snapshotted(
    path: Path, original: Path, content: str, fresh: bool = False, drop=()
) -> None:
    """Write a text file, preserving the pre-edit version at `original` on the first edit so revert works later."""

    # fresh marks new pipeline output: any snapshot describes text it replaces, so it goes with the `drop` records.
    if fresh:
        # Probe all first, so a lock on any of them cannot leave another deleted and the write undone.
        check_none_locked((path, original, *drop))
        try:
            original.unlink(missing_ok=True)
        except PermissionError as e:
            reject_if_locked(e, original.name)
            raise
        for p in drop:
            try:
                p.unlink(missing_ok=True)
            except PermissionError as e:
                reject_if_locked(e, p.name)
                raise
    try:
        if not fresh and not original.exists() and path.exists():
            path.rename(original)
        path.write_text(content, encoding="utf-8")
    except PermissionError as e:
        # Past the snapshot unlink only the file itself is touched: the rename's source and the write's target.
        reject_if_locked(e, path.name)
        raise


def restore_snapshot(path: Path, original: Path) -> None:
    """Restore `path` from `original` and drop the snapshot; no-op if there is none."""

    if not original.exists():
        return
    try:
        data = original.read_bytes()
    except PermissionError as e:
        reject_if_locked(e, original.name)
        raise
    try:
        path.write_bytes(data)
    except PermissionError as e:
        reject_if_locked(e, path.name)
        raise
    try:
        original.unlink()
    except PermissionError as e:
        reject_if_locked(e, original.name)
        raise


def write_summary(
    course: str, lecture: str, kind: str, content: str, fresh: bool = False
) -> None:
    """Write the summary, preserving the pre-edit version as original_summary.md on the first edit so revert works later."""

    summary_path, original_path = _paths(course, lecture, kind)
    try:
        # The record names the run that wrote the old text; the backend re-PUTs it after a fresh write.
        write_snapshotted(
            summary_path,
            original_path,
            content,
            fresh,
            (summary_path.parent / SUMMARY_MATERIALS_MARKER,),
        )
    except FileNotFoundError:
        # No mkdir here: a summary landing after its lecture was deleted must not resurrect it.
        if summary_path.parent.is_dir():
            raise
        raise LectureNotFound(
            f"{course}/{lecture} does not exist", course=course, lecture=lecture
        ) from None


def revert_summary(course: str, lecture: str, kind: str) -> None:
    """Restore summary.md from original_summary.md and drop the original marker; no-op if no original exists."""

    summary_path, original_path = _paths(course, lecture, kind)
    restore_snapshot(summary_path, original_path)


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
    """Atomically record the materials attached at the last Summarize; no mkdir, so a gone lecture 404s."""

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
