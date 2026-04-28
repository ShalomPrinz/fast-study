import os
import sys
import math
import subprocess
import tempfile
from pathlib import Path
from groq import Groq

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
CHUNK_MINUTES = 10
MAX_SIZE_MB = 24


def extract_audio(video_path: str, audio_path: str):
    print(f"Extracting audio from {video_path}...")
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
        audio_path
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Audio extracted: {audio_path}")


def get_duration(audio_path: str) -> float:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audio_path
    ], capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def split_audio(audio_path: str, tmpdir: str, chunk_seconds: int) -> list[str]:
    duration = get_duration(audio_path)
    num_chunks = math.ceil(duration / chunk_seconds)
    print(f"Total duration: {duration/60:.1f} min → splitting into {num_chunks} chunks")

    chunks = []
    for i in range(num_chunks):
        start = i * chunk_seconds
        chunk_path = os.path.join(tmpdir, f"chunk_{i:04d}.mp3")
        subprocess.run([
            "ffmpeg", "-y", "-i", audio_path,
            "-ss", str(start), "-t", str(chunk_seconds),
            "-ar", "16000", "-ac", "1", "-b:a", "32k",
            chunk_path
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        chunks.append(chunk_path)
    return chunks


def transcribe_chunk(client: Groq, chunk_path: str, chunk_index: int, total: int) -> str:
    print(f"  Transcribing chunk {chunk_index + 1}/{total}...")
    with open(chunk_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=f,
            language="he",
            response_format="text",
        )
    return response


def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <video.mp4> [api_key]")
        sys.exit(1)

    video_path = sys.argv[1]
    if not os.path.exists(video_path):
        print(f"File not found: {video_path}")
        sys.exit(1)

    api_key = sys.argv[2] if len(sys.argv) > 2 else GROQ_API_KEY
    if not api_key:
        print("Error: GROQ_API_KEY not set. Pass it as second argument or set the env var.")
        sys.exit(1)

    client = Groq(api_key=api_key)
    output_path = Path(video_path).stem + "_transcript.txt"

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, "audio.mp3")
        extract_audio(video_path, audio_path)

        chunk_seconds = CHUNK_MINUTES * 60
        chunks = split_audio(audio_path, tmpdir, chunk_seconds)

        print(f"Transcribing {len(chunks)} chunks with Groq (whisper-large-v3, Hebrew)...")
        parts = []
        for i, chunk in enumerate(chunks):
            text = transcribe_chunk(client, chunk, i, len(chunks))
            parts.append(text.strip())

        full_transcript = "\n\n".join(parts)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(full_transcript)

    print(f"\nDone! Transcript saved to: {output_path}")


if __name__ == "__main__":
    main()
