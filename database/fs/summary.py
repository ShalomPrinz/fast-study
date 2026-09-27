from .paths import lecture_dir, reject_if_locked


def _paths(course: str, lecture: str, kind: str):
    """Return (summary.md, original_summary.md) paths for the lecture."""

    d = lecture_dir(course, lecture, kind)
    return d / "summary.md", d / "original_summary.md"


def read_summary(course: str, lecture: str, kind: str) -> dict:
    """Return the current summary content plus whether an untouched original is preserved."""

    summary_path, original_path = _paths(course, lecture, kind)
    content = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
    return {"content": content, "hasOriginal": original_path.exists()}


def write_summary(course: str, lecture: str, kind: str, content: str) -> None:
    """Write the summary, preserving the pre-edit version as original_summary.md on the first edit so revert works later."""

    summary_path, original_path = _paths(course, lecture, kind)
    try:
        if not original_path.exists() and summary_path.exists():
            summary_path.rename(original_path)
        summary_path.write_text(content, encoding="utf-8")
    except PermissionError as e:
        # Only summary.md is ever open at this point: the rename's source and the write's target.
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
