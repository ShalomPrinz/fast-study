import os
from pathlib import Path

RECITATIONS_DIR = "Recitations"

# Empty marker file inside a course dir flagging it as archived. Survives renames.
ARCHIVED_MARKER = ".archived"

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


def lecture_dir(course: str, lecture: str, kind: str = "lecture") -> Path:
    """Resolve the directory for a lecture or recitation under its course."""

    if kind == "recitation":
        return data_root() / course / RECITATIONS_DIR / lecture
    return data_root() / course / lecture
