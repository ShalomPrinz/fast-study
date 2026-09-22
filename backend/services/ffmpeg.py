import subprocess

from tools import tool_path

# Enough for ffmpeg's error lines; a full log would bloat the failure's `detail` param.
_STDERR_TAIL_CHARS = 2000


class FfmpegError(Exception):
    """A non-zero ffmpeg exit; `str()` is the stderr tail, or the exit status when it printed nothing."""


def run_ffmpeg(args: list[str]) -> None:
    """Run ffmpeg quietly with `args`, raising FfmpegError carrying its error lines on failure."""

    result = subprocess.run(
        [tool_path("ffmpeg"), "-hide_banner", "-loglevel", "error", *args],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        # errors="replace": ffmpeg echoes input paths as raw bytes, not always UTF-8.
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise FfmpegError(
            stderr[-_STDERR_TAIL_CHARS:] or f"ffmpeg exited {result.returncode}"
        )
