from pathlib import Path

from .material_meta import read_json_dict, write_json_dict
from .paths import (
    SKIPPED_MARKER,
    VIDEO_SOURCE_MARKER,
    CodedValueError,
    CourseNotFound,
    course_dir,
)


def read_skipped(course_path: Path) -> list[str]:
    """Read a course's skipped refs in insertion order; absent, corrupt or mistyped reads as []."""

    refs = read_json_dict(course_path, SKIPPED_MARKER).get("refs")
    if not isinstance(refs, list):
        return []
    return list(dict.fromkeys(r for r in refs if isinstance(r, str) and r))


def _ref_list(value: object, field: str) -> list[str]:
    """Validate an add/remove body field: absent is [], else a list of non-empty strings."""

    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(r, str) and r for r in value):
        raise CodedValueError(
            f"{field} must be a list of non-empty strings",
            "bad_request_body",
            detail=f"{field} must be a list of non-empty strings",
        )
    return value


def update_skipped(course: str, body: object) -> tuple[list[str], bool]:
    """Apply a {add?, remove?} batch to the course's skip set (adds first, removes win) and return (refs, changed); CourseNotFound if the dir is gone."""

    if not isinstance(body, dict):
        raise CodedValueError(
            "body must be an object",
            "bad_request_body",
            detail="body must be an object",
        )
    adds, removes = (
        _ref_list(body.get("add"), "add"),
        _ref_list(body.get("remove"), "remove"),
    )
    d = course_dir(course)
    if not d.is_dir():
        raise CourseNotFound(f"course not found: {course}", course=course)
    before = read_skipped(d)
    drop = set(removes)
    after = [r for r in dict.fromkeys([*before, *adds]) if r not in drop]
    if after == before:
        return after, False
    write_json_dict(d, SKIPPED_MARKER, {"refs": after} if after else {}, strict=True)
    return after, True


def read_video_source(lecture_path: Path) -> str | None:
    """Read the lecture's video discovery ref; absent, corrupt or empty reads as None."""

    source = read_json_dict(lecture_path, VIDEO_SOURCE_MARKER).get("source")
    return source if isinstance(source, str) and source else None


def write_video_source(lecture_path: Path, source: str) -> None:
    """Record the ref of the video just saved; best-effort, so a failure leaves no ref (the caller already wiped the old one)."""

    write_json_dict(lecture_path, VIDEO_SOURCE_MARKER, {"source": source})
