import os
from pathlib import Path

RECITATIONS_DIR = "Recitations"

# Course-level dir for overview pipeline outputs (files belong to the course, not a lecture).
OVERVIEW_DIR = "overview"

# Course-dir dotfiles: empty archived flag, and the auto-downloader's lecture-site URL.
ARCHIVED_MARKER = ".archived"
SOURCE_URL_MARKER = ".source_url"

# Lecture-dir dotfiles: one line of XeLaTeX warning text for summary.pdf, and the generated
# LaTeX the backend keeps only on a hard render failure. Dotfiles never become tree rows.
PDF_WARNING_MARKER = ".pdf_warning"
PDF_BUILD_TEX_MARKER = ".pdf_build.tex"

# Every file the frontend cares about in a lecture dir: the tree surfaces exactly these,
# and re-uploading video.mp4 wipes exactly these. See docs/LAYOUT.md.
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


def overview_pdf_warning_marker(slug: str) -> str:
    """Name of the overview dotfile holding one line of XeLaTeX warning text for {slug}.pdf (one per extractor)."""

    return f".{slug}{PDF_WARNING_MARKER}"


def lecture_dir(course: str, lecture: str, kind: str = "lecture") -> Path:
    """Resolve the directory for a lecture or recitation under its course."""

    if kind == "recitation":
        return data_root() / course / RECITATIONS_DIR / lecture
    return data_root() / course / lecture
