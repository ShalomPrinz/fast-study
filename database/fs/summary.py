from .paths import lecture_dir


def _paths(course: str, lecture: str, kind: str):
    d = lecture_dir(course, lecture, kind)
    return d / "summary.md", d / "original_summary.md"


def read_summary(course: str, lecture: str, kind: str) -> dict:
    summary_path, original_path = _paths(course, lecture, kind)
    content = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
    return {"content": content, "hasOriginal": original_path.exists()}


def write_summary(course: str, lecture: str, kind: str, content: str) -> None:
    summary_path, original_path = _paths(course, lecture, kind)
    if not original_path.exists() and summary_path.exists():
        summary_path.rename(original_path)
    summary_path.write_text(content, encoding="utf-8")


def revert_summary(course: str, lecture: str, kind: str) -> None:
    summary_path, original_path = _paths(course, lecture, kind)
    if original_path.exists():
        summary_path.write_bytes(original_path.read_bytes())
        original_path.unlink()
