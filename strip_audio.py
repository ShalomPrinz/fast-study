import sys
import subprocess
from pathlib import Path


def strip_audio(video_path: str, audio_path: str):
    print(f"Extracting audio from {video_path}...")
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
        audio_path
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Audio saved to: {audio_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 strip_audio.py <video.mp4> [output.mp3]")
        sys.exit(1)

    video = sys.argv[1]
    audio = sys.argv[2] if len(sys.argv) > 2 else Path(video).stem + ".mp3"

    strip_audio(video, audio)
