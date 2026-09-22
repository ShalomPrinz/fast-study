"""The audio step's failure code: every ffmpeg failure is `audio_extraction_failed`, with
ffmpeg's own error lines (or the OS error) as `detail`."""

import subprocess
from unittest.mock import patch

import pytest
from strip_audio import strip_audio

_REFUSED = subprocess.CompletedProcess(
    [], 1, stderr=b"video.mp4: Invalid data found when processing input\n"
)


@pytest.mark.parametrize(
    ("run", "detail"),
    [
        (
            {"return_value": _REFUSED},
            "video.mp4: Invalid data found when processing input",
        ),
        (
            {"side_effect": FileNotFoundError("No such file or directory: 'ffmpeg'")},
            "No such file or directory: 'ffmpeg'",
        ),
    ],
    ids=["ffmpeg refused the video", "ffmpeg is not installed"],
)
def test_every_ffmpeg_failure_is_one_code(tmp_path, run, detail):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"not a video")
    with patch("subprocess.run", **run):
        with pytest.raises(RuntimeError) as e:
            strip_audio(str(video), str(tmp_path / "audio.mp3"))
    assert e.value.code == "audio_extraction_failed"
    assert e.value.params == {"detail": detail}
