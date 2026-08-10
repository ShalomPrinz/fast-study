from .materials import material_names
from .paths import (
    ARCHIVED_MARKER,
    PDF_BUILD_TEX_MARKER,
    PDF_WARNING_MARKER,
    PREDEFINED_FILES,
    RECITATIONS_DIR,
    SOURCE_URL_MARKER,
    course_dir,
    data_root,
    lecture_dir,
)


def create_course(name: str, source_url: str | None = None) -> None:
    """Create a new course directory under DATA_ROOT (idempotent), optionally seeding its source_url."""

    (data_root() / name).mkdir(parents=True, exist_ok=True)
    if source_url:
        set_course_source_url(name, source_url)


def set_course_source_url(name: str, source_url: str | None) -> None:
    """Write (or clear when empty/None) the course's source URL in its .source_url dotfile."""

    marker = course_dir(name) / SOURCE_URL_MARKER
    url = (source_url or "").strip()
    if url:
        marker.write_text(url, encoding="utf-8")
    elif marker.exists():
        marker.unlink()


def set_course_archived(name: str, archived: bool) -> None:
    """Create or remove the .archived marker inside a course dir (idempotent)."""

    marker = course_dir(name) / ARCHIVED_MARKER
    if archived:
        marker.touch(exist_ok=True)
    elif marker.exists():
        marker.unlink()


def rename_course(old: str, new: str) -> None:
    """Rename a course directory in place."""

    (data_root() / old).rename(data_root() / new)


def create_lecture(course: str, name: str, kind: str) -> None:
    """Create a lecture or recitation directory, creating the Recitations parent on demand."""

    if kind == "recitation":
        parent = data_root() / course / RECITATIONS_DIR
        parent.mkdir(parents=True, exist_ok=True)
        (parent / name).mkdir(parents=True, exist_ok=True)
    else:
        (data_root() / course / name).mkdir(parents=True, exist_ok=True)


def rename_lecture(course: str, old: str, new: str, kind: str) -> None:
    """Rename a lecture or recitation directory in place."""

    lecture_dir(course, old, kind).rename(lecture_dir(course, new, kind))


def write_video(course: str, lecture: str, kind: str, data: bytes) -> None:
    """Save video.mp4 for the lecture, wiping all derived artifacts so they get regenerated from the new source."""

    d = lecture_dir(course, lecture, kind)
    # The downloader uploads here for brand-new lectures, so create the dir if missing.
    d.mkdir(parents=True, exist_ok=True)
    # Materials go too: a fresh video means the folder is re-sourced from scratch, so a
    # re-upload is a reset, not an append.
    for f in (
        *PREDEFINED_FILES,
        *material_names(d),
        "transcript.partial.meta.json",
        PDF_WARNING_MARKER,
        PDF_BUILD_TEX_MARKER,
    ):
        p = d / f
        if p.exists():
            p.unlink()
    (d / "video.mp4").write_bytes(data)


def delete_file(course: str, lecture: str, file: str, kind: str) -> None:
    """Delete a single file in a lecture dir if present; deleting summary.pdf also drops .pdf_warning,
    which describes THIS pdf and can never outlive it."""

    d = lecture_dir(course, lecture, kind)
    p = d / file
    if p.exists():
        p.unlink()
    if file == "summary.pdf":
        (d / PDF_WARNING_MARKER).unlink(missing_ok=True)


def write_file(course: str, lecture: str, file: str, kind: str, data: bytes) -> None:
    """Write raw bytes to one file in a lecture dir; neutral — does NOT wipe derived artifacts."""

    d = lecture_dir(course, lecture, kind)
    d.mkdir(parents=True, exist_ok=True)
    (d / file).write_bytes(data)
