import os
from pathlib import Path

RECITATIONS_DIR = "Recitations"

# Course-level dir for overview pipeline outputs (files belong to the course, not a lecture).
OVERVIEW_DIR = "overview"

# Empty marker file inside a course dir flagging it as archived. Survives renames.
ARCHIVED_MARKER = ".archived"

# Dotfile inside a course dir holding the lecture-site URL.
# Unlike .archived it carries content (the URL); a dotfile so tree iteration (dirs only) ignores it, and it survives renames.
SOURCE_URL_MARKER = ".source_url"

# Every file the frontend cares about in a lecture dir. Single source of truth —
# tree responses surface all of these, and re-uploading video.mp4 wipes the rest.
PREDEFINED_FILES = (
    "video.mp4",
    "audio.mp3",
    "transcript.txt",
    "transcript.partial.txt",
    "summary.md",
    "summary.pdf",
    "drive_url.txt",
    "material.pdf",
)


def data_root() -> Path:
    """Return the root directory holding all course data."""

    return Path(os.environ["DATA_ROOT"])


def course_dir(course: str) -> Path:
    """Return the directory for a single course."""

    return data_root() / course


def overview_dir(course: str) -> Path:
    """Return the course-level overview directory holding cross-lecture study files."""

    return data_root() / course / OVERVIEW_DIR


def lecture_dir(course: str, lecture: str, kind: str = "lecture") -> Path:
    """Resolve the directory for a lecture or recitation under its course."""

    if kind == "recitation":
        return data_root() / course / RECITATIONS_DIR / lecture
    return data_root() / course / lecture
