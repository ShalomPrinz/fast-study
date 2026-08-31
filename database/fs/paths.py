from pathlib import Path

RECITATIONS_DIR = "Recitations"

# Windows rejects these in a path component
ILLEGAL_NAME_CHARS = set('<>:"/\\|?*') | {chr(c) for c in range(32)}

# Device names are reserved with or without an extension, so CON.txt is refused too.
RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL"} | {
    f"{p}{i}" for p in ("COM", "LPT") for i in "123456789¹²³"
}

# Leaves headroom under MAX_PATH
MAX_NAME_LEN = 80

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
)

# Material PDFs are a numbered family, not a predefined name: material.pdf, material.2.pdf, …
MATERIAL_PREFIX = "material"
MATERIAL_EXT = ".pdf"

# The data root as explicit module state: unset until main.py seeds it or POST /config sets it.
_data_root: Path | None = None


class DataRootNotConfigured(Exception):
    """Raised when a path is resolved before a data root has been configured."""


def material_name(index: int) -> str:
    """Build the material filename for a 1-based index; index 1 is the unnumbered material.pdf."""

    if index <= 1:
        return f"{MATERIAL_PREFIX}{MATERIAL_EXT}"
    return f"{MATERIAL_PREFIX}.{index}{MATERIAL_EXT}"


def material_index(name: str) -> int | None:
    """Return the 1-based index of a material filename, or None if the name isn't one."""

    if not name.startswith(f"{MATERIAL_PREFIX}.") or not name.endswith(MATERIAL_EXT):
        return None
    middle = name[len(MATERIAL_PREFIX) + 1 : -len(MATERIAL_EXT)]
    if not middle:
        return 1
    # Reject padded/signed forms so each index has exactly one spelling on disk.
    return int(middle) if middle.isdigit() and not middle.startswith("0") else None


def set_data_root(value: str | Path) -> None:
    """Set the root directory holding all course data; the single writer of that state."""

    global _data_root
    _data_root = Path(value)


def data_root() -> Path:
    """Return the root directory holding all course data, or raise if none is configured."""

    # Refusing beats defaulting: a relative or empty root would silently write into the service's cwd.
    if _data_root is None:
        raise DataRootNotConfigured(
            "data root is not configured — set DATA_ROOT in the repo-root .env, or POST /config"
        )
    return _data_root


def safe_name(name: str) -> str:
    """Reduce a course/lecture name to a component that is legal on NTFS as well as ext4."""

    cleaned = "".join(c for c in name if c not in ILLEGAL_NAME_CHARS).strip()
    # Windows silently strips trailing dots and spaces, which would desync the name from disk.
    cleaned = cleaned[:MAX_NAME_LEN].rstrip(". ")
    if cleaned.split(".")[0].upper() in RESERVED_NAMES:
        cleaned += "_"
    if not cleaned:
        raise ValueError(f"name has no legal characters: {name!r}")
    return cleaned


def course_dir(course: str) -> Path:
    """Return the directory for a single course."""

    return data_root() / safe_name(course)


def overview_dir(course: str) -> Path:
    """Return the course-level overview directory holding cross-lecture study files."""

    return course_dir(course) / OVERVIEW_DIR


def overview_pdf_warning_marker(slug: str) -> str:
    """Name of the overview dotfile holding one line of XeLaTeX warning text for {slug}.pdf (one per extractor)."""

    return f".{slug}{PDF_WARNING_MARKER}"


def lecture_dir(course: str, lecture: str, kind: str = "lecture") -> Path:
    """Resolve the directory for a lecture or recitation under its course."""

    if kind == "recitation":
        return course_dir(course) / RECITATIONS_DIR / safe_name(lecture)
    return course_dir(course) / safe_name(lecture)
