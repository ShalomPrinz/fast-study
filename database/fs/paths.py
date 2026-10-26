import errno
import os
import re
import stat
import sys
from pathlib import Path

RECITATIONS_DIR = "Recitations"
# Course-level dir of assignment folders (a third node kind, outside lecture_dir); reserved as a lecture name.
ASSIGNMENTS_DIR = "Assignments"
# Assignment-dir dotfile: {filename: source} for files written with a source.
ASSIGNMENT_FILES_MARKER = ".assignment_files.json"
# Assignment-dir dotfile: {"attach": {file: false}, "lectures": [{name, kind}]}, the AI docs' inputs.
ASSIGNMENT_META_MARKER = ".assignment_meta.json"
# Assignment-dir subfolder holding the generated AI docs; the doc ids it holds are ASSIGNMENT_DOCS.
GENERATED_DIR = ".generated"
ASSIGNMENT_DOCS = ("intuition", "solution")

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

# Course-dir dotfiles: empty archived flag, empty lectures-only pick, and the auto-downloader's lecture-site URL.
ARCHIVED_MARKER = ".archived"
LECTURES_ONLY_MARKER = ".lectures_only"
SOURCE_URL_MARKER = ".source_url"

# Lecture-dir dotfiles: one line of LaTeX warning text for summary.pdf, and the generated
# LaTeX the backend keeps only on a hard render failure. Dotfiles never become tree rows.
PDF_WARNING_MARKER = ".pdf_warning"
PDF_BUILD_TEX_MARKER = ".pdf_build.tex"
# Lecture-dir empty marker: the user studied it. A video upload keeps it — it describes the study, not the video.
DONE_MARKER = ".done"

# The tree surfaces exactly these and a fresh video.mp4 wipes these plus its side-files — see docs/LAYOUT.md.
PREDEFINED_FILES = (
    "video.mp4",
    "audio.mp3",
    "transcript.txt",
    "transcript.partial.txt",
    "summary.md",
    "summary.pdf",
    "drive_url.txt",
)

# The only files the remove route will delete; when to remove them is the backend's policy.
REMOVABLE_FILES = ("video.mp4", "audio.mp3")

# Materials of any extension are a numbered family, not a predefined name: material.pdf, material.2.pptx, …
MATERIAL_PREFIX = "material"
# Same rule as auto's NAMED_FILE (1-5 lower-case alphanumerics), but never all digits: material.2 is no material.
MATERIAL_EXT_RE = re.compile(r"(?![0-9]+$)[a-z0-9]{1,5}")
# Lecture-dir sidecar mapping a material filename to its meta: {source, filename, attach}.
MATERIAL_META_MARKER = ".materials.json"
# Lecture-dir record of the materials attached at the last Summarize (the run that wrote the current summary.md).
SUMMARY_MATERIALS_MARKER = ".summary_materials.json"

# The data root as explicit module state: unset until database_main.py seeds it or POST /config sets it.
_data_root: Path | None = None


class CodedError(Exception):
    """A failure carrying its machine code and flat params beside today's English prose."""

    # A subclass that always means one failure names it here; the generic ones pass it in.
    code = ""

    def __init__(self, message: str, code: str = "", **params):
        """Keep the prose as str(exc) and the code with its flat params beside it."""

        super().__init__(message)
        self.code = code or self.code
        self.params = params


class CodedValueError(CodedError, ValueError):
    """A coded failure that is also a ValueError, so callers catching ValueError still catch it."""


class DataRootNotConfigured(CodedError):
    """Raised when a path is resolved before a data root has been configured."""

    code = "data_root_not_configured"


class FileLocked(CodedError):
    """Raised when a write or delete is refused because another program holds the file open."""

    code = "file_locked"


class FolderInUse(CodedError):
    """Raised when a folder rename is refused because another program holds a file inside it open."""

    code = "folder_in_use"


class CourseNotFound(CodedError, FileNotFoundError):
    """Raised when a course directory named by a request does not exist."""

    code = "course_not_found"


class NameTaken(CodedError):
    """Raised when a create or rename targets a course/lecture name that already exists."""

    code = "name_taken"


class NameReserved(CodedError):
    """Raised when a lecture/recitation create or rename targets a folder name the layout reserves."""

    code = "name_reserved"


class LectureNotFound(CodedError):
    """Raised when a neutral write targets a lecture dir that does not exist; only a video upload creates one."""

    code = "lecture_not_found"


class AssignmentFileNotFound(CodedError, FileNotFoundError):
    """Raised when a route names an assignment file or doc that is not there."""

    code = "file_not_found"


# ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION, as os.unlink/os.replace report them — see docs/API.md.
_SHARING_VIOLATIONS = (32, 33)


def check_safe_segment(segment: str) -> None:
    """Reject a course/file name that could escape its directory (path separators or '..')."""

    if (
        not segment
        or segment in (".", "..")
        or "/" in segment
        or "\\" in segment
        or "\x00" in segment
    ):
        raise CodedValueError(
            f"unsafe path segment: {segment!r}", "unsafe_path_segment", segment=segment
        )


def _denied_by_share(exc: PermissionError) -> bool:
    """Tell whether a winerror-less Windows EACCES can only be a sharing violation."""

    # The CRT path sets errno but no winerror, so only an EACCES on a writable regular file counts —
    # see docs/API.md.
    if sys.platform != "win32" or exc.errno != errno.EACCES or not exc.filename:
        return False
    try:
        st = os.stat(exc.filename)
    except OSError:
        return False
    return stat.S_ISREG(st.st_mode) and bool(st.st_mode & stat.S_IWRITE)


def reject_if_locked(exc: PermissionError, file: str) -> None:
    """Turn a Windows sharing violation into FileLocked; let every other PermissionError through."""

    # POSIX has no mandatory locking, so a bare PermissionError there is a real permissions
    # problem — relabelling it would send the user chasing a viewer that isn't the cause.
    if getattr(exc, "winerror", None) in _SHARING_VIOLATIONS or _denied_by_share(exc):
        raise FileLocked(
            f"{file} is open in another program. Close it and try again.", file=file
        ) from exc


def check_none_locked(paths) -> None:
    """Raise FileLocked if any of the given files is held open by another program."""

    # Opening for update is how a Windows sharing violation surfaces without touching the file;
    # every other error is left to the operation itself, which is the one that has to succeed.
    for p in paths:
        try:
            with p.open("r+b"):
                pass
        except PermissionError as e:
            reject_if_locked(e, p.name)
        except OSError:
            continue


def material_name(index: int, ext: str = ".pdf") -> str:
    """Build the material filename for a 1-based index and a dotted ext; index 1 is the unnumbered material<ext>."""

    ext = ext.lower()
    if index <= 1:
        return f"{MATERIAL_PREFIX}{ext}"
    return f"{MATERIAL_PREFIX}.{index}{ext}"


def material_index(name: str) -> int | None:
    """Return the 1-based index of a material filename, or None if the name isn't one."""

    parts = name.split(".")
    if parts[0] != MATERIAL_PREFIX or len(parts) not in (2, 3):
        return None
    if not MATERIAL_EXT_RE.fullmatch(parts[-1]):
        return None
    if len(parts) == 2:
        return 1
    # Reject padded/signed forms and 0/1 so each index has exactly one spelling on disk.
    mid = parts[1]
    return (
        int(mid)
        if mid.isdigit() and not mid.startswith("0") and int(mid) >= 2
        else None
    )


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


def defuse_reserved(name: str) -> str:
    """Insert `_` after a reserved device base, before the first dot (`com1.txt` -> `com1_.txt`).

    Win32 matches the text before the first dot with trailing spaces stripped, so a suffix at the end would not help.
    """

    head, dot, rest = name.partition(".")
    if head.rstrip(" ").upper() in RESERVED_NAMES:
        return f"{head}_{dot}{rest}"
    return name


def safe_name(name: str) -> str:
    """Reduce a course/lecture name to a component that is legal on NTFS as well as ext4."""

    cleaned = "".join(c for c in name if c not in ILLEGAL_NAME_CHARS).strip()
    # Windows silently strips trailing dots and spaces, which would desync the name from disk.
    # Defuse before the cap (the `_` must not overflow), and again after: a cut inside trailing spaces drops it.
    cleaned = defuse_reserved(defuse_reserved(cleaned)[:MAX_NAME_LEN].rstrip(". "))
    if not cleaned:
        raise CodedValueError(
            f"name has no legal characters: {name!r}",
            "name_has_no_legal_characters",
            name=name,
        )
    return cleaned


def course_dir(course: str) -> Path:
    """Return the directory for a single course."""

    return data_root() / safe_name(course)


def overview_dir(course: str) -> Path:
    """Return the course-level overview directory holding cross-lecture study files."""

    return course_dir(course) / OVERVIEW_DIR


def overview_pdf_warning_marker(slug: str) -> str:
    """Name of the overview dotfile holding one line of LaTeX warning text for {slug}.pdf (one per extractor)."""

    return f".{slug}{PDF_WARNING_MARKER}"


def lecture_dir(course: str, lecture: str, kind: str = "lecture") -> Path:
    """Resolve the directory for a lecture or recitation under its course."""

    if kind == "recitation":
        return course_dir(course) / RECITATIONS_DIR / safe_name(lecture)
    return course_dir(course) / safe_name(lecture)


def assignment_dir(course: str, name: str) -> Path:
    """Resolve an assignment's directory; deliberately not a lecture kind, so no lecture route can address it."""

    return course_dir(course) / ASSIGNMENTS_DIR / safe_name(name)
