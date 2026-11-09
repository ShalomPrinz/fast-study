import re
from pathlib import Path

from .paths import (
    FIGURES_DIR,
    CodedValueError,
    LectureNotFound,
    check_none_locked,
    lecture_dir,
    reject_if_locked,
)

# The backend writes exactly fig<N>.<ext>; anything else is refused so the folder stays one flat, known family.
FIGURE_NAME_RE = re.compile(r"fig([0-9]+)\.(?:pdf|png|jpg|jpeg|gif)")


def check_figure_name(name: str) -> None:
    """Refuse a figure name that is not fig<N>.<pdf|png|jpg|jpeg|gif>; the pattern also rules out separators and '..'."""

    if not FIGURE_NAME_RE.fullmatch(name):
        raise CodedValueError(
            f"invalid figure name: {name!r}", "figure_name_invalid", name=name
        )


def figure_files(d: Path) -> list[Path]:
    """List every file under a lecture dir's figures/ folder (empty when it is absent); the wipe and the clear share it."""

    f = d / FIGURES_DIR
    return [p for p in f.iterdir() if p.is_file()] if f.is_dir() else []


def wipe_figures(d: Path, probed: bool = False) -> None:
    """Delete the figures/ folder's files and then the folder; all-or-nothing on locks unless the caller already probed."""

    files = figure_files(d)
    if not probed:
        check_none_locked(files)
    for p in files:
        try:
            p.unlink(missing_ok=True)
        except PermissionError as e:
            reject_if_locked(e, p.name)
            raise
    try:
        (d / FIGURES_DIR).rmdir()
    except OSError:
        # Absent, or a stray subfolder we never wrote: the folder itself is not worth failing over.
        pass


def _require_lecture(course: str, lecture: str, kind: str) -> Path:
    """Resolve the lecture dir, raising LectureNotFound when it is gone."""

    d = lecture_dir(course, lecture, kind)
    if not d.is_dir():
        raise LectureNotFound(
            f"{course}/{lecture} does not exist", course=course, lecture=lecture
        )
    return d


def figure_path(course: str, lecture: str, name: str, kind: str) -> Path:
    """Resolve one figure's on-disk path after validating its name."""

    check_figure_name(name)
    return lecture_dir(course, lecture, kind) / FIGURES_DIR / name


def write_figure(course: str, lecture: str, name: str, kind: str, data: bytes) -> None:
    """Write one figure into an existing lecture, creating figures/ on demand; neutral like the files route."""

    check_figure_name(name)
    d = _require_lecture(course, lecture, kind)
    (d / FIGURES_DIR).mkdir(exist_ok=True)
    try:
        (d / FIGURES_DIR / name).write_bytes(data)
    except PermissionError as e:
        reject_if_locked(e, name)
        raise


def list_figures(course: str, lecture: str, kind: str) -> list[str]:
    """Return the figure names in natural order (fig2 before fig10); [] for a missing lecture or folder."""

    f = lecture_dir(course, lecture, kind) / FIGURES_DIR
    if not f.is_dir():
        return []
    found = [
        (int(m.group(1)), p.name)
        for p in f.iterdir()
        if p.is_file() and (m := FIGURE_NAME_RE.fullmatch(p.name))
    ]
    return [name for _, name in sorted(found)]


def clear_figures(course: str, lecture: str, kind: str) -> None:
    """Delete every figure of an existing lecture (idempotent); the backend clears before writing a fresh set."""

    wipe_figures(_require_lecture(course, lecture, kind))
