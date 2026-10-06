import os
import sys
from pathlib import Path

from .paths import (
    ARCHIVED_MARKER,
    OVERVIEW_DIR,
    PDF_BUILD_TEX_MARKER,
    PDF_WARNING_MARKER,
    PREDEFINED_FILES,
    RECITATIONS_DIR,
    SOURCE_URL_MARKER,
    CourseNotFound,
    FolderInUse,
    LectureNotFound,
    NameReserved,
    NameTaken,
    check_none_locked,
    check_safe_segment,
    course_dir,
    lecture_dir,
    reject_if_locked,
    safe_name,
)

# Course-level folders the tree skips as lectures; casefolded because NTFS matches names case-insensitively.
_RESERVED_LECTURE_NAMES = {OVERVIEW_DIR.casefold(), RECITATIONS_DIR.casefold()}


def _mkdir_new(d: Path) -> None:
    """Create a directory, refusing one that already exists; the mkdir itself is the atomic check."""

    try:
        d.mkdir(parents=True)
    except FileExistsError:
        # The sanitized folder name, not the typed one: that is what the user will find in the tree.
        raise NameTaken(f"'{d.name}' already exists", name=d.name) from None


def _rename_dir(old: Path, new: Path, old_name: str) -> None:
    """Rename a directory, refusing an existing target unless it is the same dir under another case."""

    # Path.rename silently replaces an empty target on POSIX; samefile lets a case-only rename through on NTFS.
    if new.exists() and not (old.exists() and os.path.samefile(old, new)):
        raise NameTaken(f"'{new.name}' already exists", name=new.name)
    try:
        old.rename(new)
    except PermissionError as e:
        # Windows answers ERROR_ACCESS_DENIED (5) for an open file at any depth; POSIX has no such lock.
        if sys.platform == "win32" and getattr(e, "winerror", None) == 5:
            raise FolderInUse(
                f"{old_name} has a file open in another program. Close it and try again.",
                name=old_name,
            ) from e
        raise


def create_course(name: str, source_url: str | None = None) -> None:
    """Create a new course directory under DATA_ROOT, optionally seeding its source_url."""

    _mkdir_new(course_dir(name))
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
    """Create or remove the .archived marker inside a course dir (idempotent); CourseNotFound if the dir is gone."""

    if not course_dir(name).is_dir():
        raise CourseNotFound(f"course not found: {name}", course=name)
    marker = course_dir(name) / ARCHIVED_MARKER
    if archived:
        marker.touch(exist_ok=True)
    elif marker.exists():
        marker.unlink()


def rename_course(old: str, new: str) -> str:
    """Rename a course directory in place and return the folder name actually created."""

    target = course_dir(new)
    _rename_dir(course_dir(old), target, old)
    return target.name


def check_not_reserved(name: str) -> None:
    """Refuse a lecture/recitation name that sanitizes onto a reserved course-level folder."""

    # A lecture dir named like one would be hidden from the tree and merged into that folder.
    if safe_name(name).casefold() in _RESERVED_LECTURE_NAMES:
        raise NameReserved(f"'{name}' is a reserved folder name", name=name)


def create_lecture(course: str, name: str, kind: str) -> str:
    """Create a lecture or recitation directory (Recitations parent on demand) and return the folder name actually created."""

    check_not_reserved(name)
    # The course is never made on demand: mkdir(parents=True) below would turn a typo into a ghost course.
    if not course_dir(course).is_dir():
        raise CourseNotFound(f"course not found: {course}", course=course)
    if kind == "recitation":
        (course_dir(course) / RECITATIONS_DIR).mkdir(parents=True, exist_ok=True)
    target = lecture_dir(course, name, kind)
    _mkdir_new(target)
    return target.name


def rename_lecture(course: str, old: str, new: str, kind: str) -> str:
    """Rename a lecture or recitation directory in place and return the folder name actually created."""

    check_not_reserved(new)
    target = lecture_dir(course, new, kind)
    _rename_dir(lecture_dir(course, old, kind), target, old)
    return target.name


def write_video(course: str, lecture: str, kind: str, data: bytes) -> None:
    """Save video.mp4 for the lecture, wiping all derived artifacts so they get regenerated from the new source."""

    # The downloader uploads here for brand-new lectures, so the create path's name check applies.
    check_not_reserved(lecture)
    # The lecture dir is made on demand, the course never: an upload still in flight when its course
    # was renamed would otherwise recreate the old name as a ghost course.
    if not course_dir(course).is_dir():
        raise CourseNotFound(f"course not found: {course}", course=course)
    d = lecture_dir(course, lecture, kind)
    d.mkdir(parents=True, exist_ok=True)
    # Materials stay: they are attached by hand or by the downloader, not derived from the video.
    # The summary snapshot goes, or "Restore original" would bring back the old video's summary.
    wipe = [
        d / f
        for f in (
            *PREDEFINED_FILES,
            "original_summary.md",
            "transcript.partial.meta.json",
            PDF_WARNING_MARKER,
            PDF_BUILD_TEX_MARKER,
        )
    ]
    # Probe the whole set before unlinking any of it: a lock hit mid-loop would leave the lecture
    # half-wiped with the new video never written.
    check_none_locked(wipe)
    for p in wipe:
        if p.exists():
            try:
                p.unlink()
            except PermissionError as e:
                reject_if_locked(e, p.name)
                raise
    (d / "video.mp4").write_bytes(data)


def delete_file(course: str, lecture: str, file: str, kind: str) -> None:
    """Delete a single file in a lecture dir if present."""

    check_safe_segment(file)
    d = lecture_dir(course, lecture, kind)
    p = d / file
    if p.exists():
        try:
            p.unlink()
        except PermissionError as e:
            reject_if_locked(e, file)
            raise
    if file == "summary.pdf":
        (d / PDF_WARNING_MARKER).unlink(missing_ok=True)
        (d / PDF_BUILD_TEX_MARKER).unlink(missing_ok=True)


def write_file(course: str, lecture: str, file: str, kind: str, data: bytes) -> None:
    """Write raw bytes to one file in an existing lecture dir; neutral — does NOT wipe derived artifacts."""

    check_safe_segment(file)
    d = lecture_dir(course, lecture, kind)
    # No mkdir: a pipeline step finishing after its lecture was deleted or renamed must not resurrect it.
    try:
        (d / file).write_bytes(data)
    except FileNotFoundError:
        # The file is a single safe segment, so only a missing lecture dir can raise this.
        raise LectureNotFound(
            f"{course}/{lecture} does not exist", course=course, lecture=lecture
        ) from None
    except PermissionError as e:
        reject_if_locked(e, file)
        raise
