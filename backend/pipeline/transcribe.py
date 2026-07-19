import json
import math
import os
import re
import subprocess
import tempfile
from pathlib import Path

import groq
from groq import Groq

from timing import timed_pipeline

CHUNK_MINUTES = 10
PARTIAL_TXT = "transcript.partial.txt"
PARTIAL_META = "transcript.partial.meta.json"


class TranscribeRateLimitError(Exception):
    def __init__(self, info: dict):
        self.info = info
        super().__init__(info.get("message", ""))


def get_duration(audio_path: str) -> float:
    """Audio duration in seconds, via ffprobe."""

    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audio_path
    ], capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def split_one_chunk(audio_path: str, tmpdir: str, index: int, chunk_seconds: int) -> str:
    """Cut one fixed-length mp3 chunk out of the audio; Groq caps a request at 25 MB."""

    chunk_path = os.path.join(tmpdir, f"chunk_{index:04d}.mp3")
    subprocess.run([
        "ffmpeg", "-y", "-i", audio_path,
        "-ss", str(index * chunk_seconds), "-t", str(chunk_seconds),
        "-ar", "16000", "-ac", "1", "-b:a", "32k",
        chunk_path
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return chunk_path


def parse_rate_limit_message(msg: str) -> dict:
    """Pull {limit, used, requested, retry_after_seconds} out of Groq's prose 429 message."""

    def _int(pattern: str):
        m = re.search(pattern, msg)
        return int(m.group(1)) if m else None

    limit = _int(r"Limit\s+(\d+)")
    used = _int(r"Used\s+(\d+)")
    requested = _int(r"Requested\s+(\d+)")

    retry_after_seconds = None
    m = re.search(r"try again in (?:(\d+)m)?\s*(\d+(?:\.\d+)?)s", msg)
    if m:
        minutes = int(m.group(1)) if m.group(1) else 0
        seconds = float(m.group(2))
        retry_after_seconds = minutes * 60 + seconds

    return {
        "limit": limit,
        "used": used,
        "requested": requested,
        "retry_after_seconds": retry_after_seconds,
    }


def _extract_groq_message(err: groq.RateLimitError) -> str:
    """The human-readable message from a Groq error, whichever shape the SDK gave it."""

    body = getattr(err, "body", None) or getattr(err, "response", None)
    if isinstance(body, dict):
        inner = body.get("error", body)
        if isinstance(inner, dict) and "message" in inner:
            return inner["message"]
    try:
        data = err.response.json()
        return data.get("error", {}).get("message", str(err))
    except Exception:
        return str(err)


def _load_resume_state(audio_path: str) -> dict:
    """The resumable state when the meta matches the current audio, else a fresh-start
    state with any stale partial files removed."""

    lecture_dir = Path(audio_path).parent
    meta_path = lecture_dir / PARTIAL_META
    partial_path = lecture_dir / PARTIAL_TXT

    stat = os.stat(audio_path)
    chunk_seconds = CHUNK_MINUTES * 60
    duration = get_duration(audio_path)
    total_chunks = math.ceil(duration / chunk_seconds)

    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if (
                meta.get("audio_size") == stat.st_size
                and meta.get("audio_mtime") == stat.st_mtime
                and meta.get("chunk_seconds") == chunk_seconds
                and meta.get("total_chunks") == total_chunks
                and isinstance(meta.get("completed_chunks"), int)
                and 0 <= meta["completed_chunks"] <= total_chunks
            ):
                return {
                    "completed_chunks": meta["completed_chunks"],
                    "total_chunks": total_chunks,
                    "chunk_seconds": chunk_seconds,
                    "fresh": False,
                }
        except (json.JSONDecodeError, OSError):
            pass

    partial_path.unlink(missing_ok=True)
    meta_path.unlink(missing_ok=True)
    return {
        "completed_chunks": 0,
        "total_chunks": total_chunks,
        "chunk_seconds": chunk_seconds,
        "fresh": True,
    }


def _write_meta_atomic(lecture_dir: Path, meta: dict) -> None:
    """Write the resume meta via a temp file + rename, so a crash can't leave it half-written."""

    tmp = lecture_dir / (PARTIAL_META + ".tmp")
    tmp.write_text(json.dumps(meta), encoding="utf-8")
    os.replace(tmp, lecture_dir / PARTIAL_META)


@timed_pipeline("transcribe")
def transcribe_audio(audio_path: str) -> str:
    """Transcribe audio to Hebrew text chunk by chunk, resuming from partial state on disk.
    Raises TranscribeRateLimitError, leaving the partial files for the next call."""

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set in the environment")
    client = Groq(api_key=api_key)
    lecture_dir = Path(audio_path).parent
    partial_path = lecture_dir / PARTIAL_TXT
    stat = os.stat(audio_path)

    state = _load_resume_state(audio_path)
    completed = state["completed_chunks"]
    total = state["total_chunks"]
    chunk_seconds = state["chunk_seconds"]

    if state["fresh"]:
        partial_path.write_text("", encoding="utf-8")
        _write_meta_atomic(lecture_dir, {
            "audio_size": stat.st_size,
            "audio_mtime": stat.st_mtime,
            "chunk_seconds": chunk_seconds,
            "completed_chunks": 0,
            "total_chunks": total,
        })

    duration = get_duration(audio_path)
    print(f"Duration: {duration/60:.1f} min → {total} chunks (resuming from {completed})")
    print(f"Transcribing with Groq (whisper-large-v3, Hebrew)...")

    with tempfile.TemporaryDirectory() as tmpdir:
        for i in range(completed, total):
            print(f"  Chunk {i + 1}/{total}...")
            chunk_path = split_one_chunk(audio_path, tmpdir, i, chunk_seconds)
            try:
                with open(chunk_path, "rb") as f:
                    response = client.audio.transcriptions.create(
                        model="whisper-large-v3",
                        file=f,
                        language="he",
                        response_format="text",
                    )
            except groq.RateLimitError as e:
                msg = _extract_groq_message(e)
                info = parse_rate_limit_message(msg)
                info["completed_chunks"] = i
                info["total_chunks"] = total
                raise TranscribeRateLimitError(info) from e

            text = response.strip() if isinstance(response, str) else str(response).strip()
            with open(partial_path, "a", encoding="utf-8") as f:
                f.write(text + "\n\n")
                f.flush()
                os.fsync(f.fileno())

            _write_meta_atomic(lecture_dir, {
                "audio_size": stat.st_size,
                "audio_mtime": stat.st_mtime,
                "chunk_seconds": chunk_seconds,
                "completed_chunks": i + 1,
                "total_chunks": total,
            })

    return partial_path.read_text(encoding="utf-8").strip()
