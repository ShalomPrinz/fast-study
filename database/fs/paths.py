import os
from pathlib import Path

RECITATIONS_DIR = "Recitations"

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
)


def data_root() -> Path:
    return Path(os.environ["DATA_ROOT"])


def course_dir(course: str) -> Path:
    return data_root() / course


def lecture_dir(course: str, lecture: str, kind: str = "lecture") -> Path:
    if kind == "recitation":
        return data_root() / course / RECITATIONS_DIR / lecture
    return data_root() / course / lecture
