"""run_ffmpeg turns a failed run into an exception whose text is ffmpeg's own error lines."""

import subprocess
from unittest.mock import patch

import pytest
from services.ffmpeg import FfmpegError, run_ffmpeg


def _run(returncode: int, stderr: bytes):
    return patch(
        "subprocess.run",
        return_value=subprocess.CompletedProcess([], returncode, stderr=stderr),
    )


def test_success_raises_nothing_and_quiets_ffmpeg():
    with _run(0, b"") as run:
        run_ffmpeg(["-i", "in.mp4", "out.mp3"])
    assert run.call_args.args[0][1:] == [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "in.mp4",
        "out.mp3",
    ]


def test_failure_carries_the_stderr_tail():
    with _run(1, b"x" * 5000 + b"in.mp4: Invalid data found when processing input\n"):
        with pytest.raises(FfmpegError) as e:
            run_ffmpeg([])
    assert len(str(e.value)) == 2000
    assert str(e.value).endswith("in.mp4: Invalid data found when processing input")


def test_non_utf8_path_does_not_mask_the_error():
    with _run(1, "הרצאה.mp4".encode("cp1255") + b": No such file or directory\n"):
        with pytest.raises(FfmpegError) as e:
            run_ffmpeg([])
    assert str(e.value).endswith(".mp4: No such file or directory")


def test_silent_failure_falls_back_to_the_exit_status():
    with _run(1, b""):
        with pytest.raises(FfmpegError, match="^ffmpeg exited 1$"):
            run_ffmpeg([])
