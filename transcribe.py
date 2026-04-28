import os
import sys
import math
import subprocess
import tempfile
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
CHUNK_MINUTES = 10


def get_duration(audio_path: str) -> float:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audio_path
    ], capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def split_audio(audio_path: str, tmpdir: str, chunk_seconds: int) -> list[str]:
    duration = get_duration(audio_path)
    num_chunks = math.ceil(duration / chunk_seconds)
    print(f"Duration: {duration/60:.1f} min → {num_chunks} chunks")

    chunks = []
    for i in range(num_chunks):
        chunk_path = os.path.join(tmpdir, f"chunk_{i:04d}.mp3")
        subprocess.run([
            "ffmpeg", "-y", "-i", audio_path,
            "-ss", str(i * chunk_seconds), "-t", str(chunk_seconds),
            "-ar", "16000", "-ac", "1", "-b:a", "32k",
            chunk_path
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        chunks.append(chunk_path)
    return chunks


def transcribe_audio(audio_path: str, api_key: str) -> str:
    client = Groq(api_key=api_key)
    chunk_seconds = CHUNK_MINUTES * 60

    with tempfile.TemporaryDirectory() as tmpdir:
        chunks = split_audio(audio_path, tmpdir, chunk_seconds)
        print(f"Transcribing {len(chunks)} chunks with Groq (whisper-large-v3, Hebrew)...")

        parts = []
        for i, chunk in enumerate(chunks):
            print(f"  Chunk {i + 1}/{len(chunks)}...")
            with open(chunk, "rb") as f:
                response = client.audio.transcriptions.create(
                    model="whisper-large-v3",
                    file=f,
                    language="he",
                    response_format="text",
                )
            parts.append(response.strip())

    return "\n\n".join(parts)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 transcribe.py <audio.mp3> [api_key]")
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}")
        sys.exit(1)

    api_key = sys.argv[2] if len(sys.argv) > 2 else GROQ_API_KEY
    if not api_key:
        print("Error: GROQ_API_KEY not set. Pass it as second argument or set the env var.")
        sys.exit(1)

    transcript = transcribe_audio(audio_path, api_key)

    output_path = Path(audio_path).stem + "_transcript.txt"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(transcript)

    print(f"Transcript saved to: {output_path}")
