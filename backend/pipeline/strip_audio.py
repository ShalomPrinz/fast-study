import logging

from services.errors import CodedError
from services.ffmpeg import run_ffmpeg
from timing import timed_pipeline

log = logging.getLogger("audio")


@timed_pipeline("audio")
def strip_audio(video_path: str, audio_path: str):
    """Extract mono 16 kHz 32 kbps audio from a video — minimal size, enough for ASR."""

    log.info(f"Extracting audio from {video_path}...")
    try:
        run_ffmpeg(
            [
                "-y",
                "-i",
                video_path,
                "-vn",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-b:a",
                "32k",
                audio_path,
            ]
        )
    except Exception as e:
        raise CodedError(str(e), "audio_extraction_failed", detail=str(e)) from e
    log.info(f"Audio saved to: {audio_path}")
