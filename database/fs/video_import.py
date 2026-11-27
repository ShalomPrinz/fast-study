import logging
import os
import threading
import time
from pathlib import Path

from .crud import (
    check_video_target,
    check_video_wipe_unlocked,
    drop_if_fresh,
    make_lecture_dir,
    place_video,
)
from .paths import CodedError, CodedValueError, new_video_tmp

log = logging.getLogger("db")

CHUNK = 4 * 1024 * 1024
# Progress lines per second are capped by this gap, so a fast local copy cannot flood the stream.
PROGRESS_INTERVAL = 0.25
MODES = ("copy", "move")


class ImportCancelled(Exception):
    """The caller went away mid-copy; the temp file is already gone."""


def check_source(raw, mode) -> Path:
    """Validate the request's mode and path and return the resolved source file; reads nothing."""

    if mode not in MODES:
        raise CodedValueError(
            "mode must be 'copy' or 'move'", "import_mode_unknown", mode=str(mode)[:20]
        )
    if not isinstance(raw, str):
        raise CodedValueError(
            "path must be a string", "bad_request_body", detail="path must be a string"
        )
    # Only the file name is ever put in a message or param: the Sentry scrubber redacts DATA_ROOT paths only.
    name = os.path.basename(raw)
    if not os.path.isabs(raw) or not os.path.exists(raw):
        raise CodedValueError(
            f"{name} does not exist", "import_source_missing", file=name
        )
    # Resolved so a symlink named x.mp4 cannot smuggle in another file, and a move acts on the real file.
    src = Path(os.path.realpath(raw))
    if not src.is_file():
        raise CodedValueError(
            f"{name} is not a file", "import_source_not_a_file", file=name
        )
    if src.suffix.lower() != ".mp4" or Path(raw).suffix.lower() != ".mp4":
        raise CodedValueError(
            f"{name} is not an .mp4 file", "import_source_not_mp4", file=name
        )
    if not os.access(src, os.R_OK):
        raise CodedValueError(
            f"{name} cannot be read", "import_source_unreadable", file=name
        )
    return src


def prepare_import(
    course: str, lecture: str, kind: str, raw_path, mode
) -> tuple[Path, Path]:
    """Run every refusal that needs no byte moved; return (lecture dir, source) ready for run_import."""

    src = check_source(raw_path, mode)
    d = check_video_target(course, lecture, kind)
    make_lecture_dir(d, True)
    try:
        target = d / "video.mp4"
        if target.exists() and os.path.samefile(src, target):
            raise CodedValueError(
                "the file already is this lecture's video",
                "import_source_is_target",
                file=src.name,
            )
        # Probed before the first byte, so a locked old video refuses without copying gigabytes.
        check_video_wipe_unlocked(d)
    except BaseException:
        drop_if_fresh(d)
        raise
    return d, src


def _copy(src: Path, tmp: Path, progress, cancelled: threading.Event) -> None:
    """Copy src to tmp in chunks, reporting progress at most every PROGRESS_INTERVAL and stopping when cancelled."""

    total = src.stat().st_size
    copied = 0
    last = time.monotonic()
    with open(src, "rb") as i, open(tmp, "wb") as o:
        while chunk := i.read(CHUNK):
            if cancelled.is_set():
                raise ImportCancelled
            o.write(chunk)
            copied += len(chunk)
            now = time.monotonic()
            if now - last >= PROGRESS_INTERVAL:
                last = now
                progress(copied, total)
    if cancelled.is_set():
        raise ImportCancelled


def _rename_into(src: Path, tmp: Path) -> bool:
    """Try the same-volume rename of src to tmp; False when it cannot (other volume, or src held open)."""

    try:
        os.replace(src, tmp)
        return True
    except OSError:
        # Cross-volume is EXDEV on POSIX, ERROR_NOT_SAME_DEVICE on Windows; a source a player holds open
        # also lands here, and the copy path then reports the real problem or finishes with originalKept.
        return False


def run_import(
    d: Path,
    src: Path,
    mode: str,
    progress,
    cancelled: threading.Event,
    touched: threading.Event,
) -> bool:
    """Place src as the lecture's video.mp4 (blocking, run in a thread); return originalKept; a failure drops a dir it made and nobody adopted."""

    try:
        return _place(d, src, mode, progress, cancelled, touched)
    finally:
        # On success the dir holds the video, so the rmdir fails and only clears the registry entry.
        drop_if_fresh(d)


def _place(d, src, mode, progress, cancelled, touched) -> bool:
    """Copy or move src into d as video.mp4; a failure or cancel leaves the source and lecture as they were unless `touched` is set."""

    tmp = new_video_tmp(d)
    if mode == "move" and _rename_into(src, tmp):
        try:
            if cancelled.is_set():
                raise ImportCancelled
            progress(tmp.stat().st_size, tmp.stat().st_size)
            place_video(d, tmp, touched.set)
        except BaseException as e:
            try:
                os.replace(tmp, src)
            except OSError:
                # The user's only copy: the temp file is never deleted, and its name is reported so it can be found.
                log.error("video import: could not put the moved source back")
                raise CodedError(
                    "the moved source could not be put back and was kept in the lecture folder",
                    "import_source_stranded",
                    kept=tmp.name,
                ) from e
            raise
        return False
    try:
        _copy(src, tmp, progress, cancelled)
        # Point of no return: the client's cancel is ignored from this line on, so it is sent unthrottled.
        size = tmp.stat().st_size
        progress(size, size)
        place_video(d, tmp, touched.set)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    if mode == "move":
        try:
            src.unlink()
        except OSError:
            return True
    return False
