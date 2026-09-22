"""The audio step's failure code. ffmpeg's stderr goes to DEVNULL, so `detail` is the exit
status and nothing more — the code is what identifies the failure (docs/PIPELINE.md)."""

import subprocess
from unittest.mock import patch

import pytest
from strip_audio import strip_audio


@pytest.mark.parametrize(
    "error",
    [
        subprocess.CalledProcessError(1, ["ffmpeg"]),
        FileNotFoundError("No such file or directory: 'ffmpeg'"),
    ],
    ids=["ffmpeg refused the video", "ffmpeg is not installed"],
)
def test_every_ffmpeg_failure_is_one_code(tmp_path, error):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"not a video")
    with patch("subprocess.run", side_effect=error):
        with pytest.raises(RuntimeError) as e:
            strip_audio(str(video), str(tmp_path / "audio.mp3"))
    assert e.value.code == "audio_extraction_failed"
    assert e.value.params == {"detail": str(error)}
