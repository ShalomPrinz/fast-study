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

# Dotfile inside a lecture dir holding one line of classified XeLaTeX warning text for summary.pdf.
# A dotfile, not a predefined file: it is not a pipeline artifact and must never become a tree row.
PDF_WARNING_MARKER = ".pdf_warning"

# Dotfile inside a lecture dir holding the generated LaTeX, kept only when a render fails hard so the reported l.<N> is lookupable.
# A dotfile for the same reason: build debris, not a pipeline artifact, so it must never become a tree row.
PDF_BUILD_TEX_MARKER = ".pdf_build.tex"

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
