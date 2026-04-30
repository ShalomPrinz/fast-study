import subprocess


def strip_audio(video_path: str, audio_path: str):
    print(f"Extracting audio from {video_path}...")
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
        audio_path
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Audio saved to: {audio_path}")
