import subprocess

from timing import timed_pipeline


@timed_pipeline("audio")
def strip_audio(video_path: str, audio_path: str):
    """Extract mono 16 kHz 32 kbps audio from a video — minimal size, enough for ASR."""

    print(f"Extracting audio from {video_path}...")
    subprocess.run(
        [
            "ffmpeg",
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
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"Audio saved to: {audio_path}")
