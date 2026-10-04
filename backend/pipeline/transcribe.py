import json
import logging
import math
import os
import re
import tempfile
from pathlib import Path

import groq
from groq import Groq
from services import providers
from services.errors import CodedError
from services.ffmpeg import run_ffmpeg
from services.mp3 import read_duration
from timing import timed_pipeline

log = logging.getLogger("transcribe")

CHUNK_SECONDS = 600
# Each chunk starts this much before the previous one ends, so no word is lost to a hard cut.
OVERLAP_SECONDS = 10
PARTIAL_TXT = "transcript.partial.txt"
PARTIAL_META = "transcript.partial.meta.json"


class TranscribeRateLimitError(Exception):
    def __init__(self, info: dict):
        self.info = info
        super().__init__(info.get("message", ""))


def get_duration(audio_path: str) -> float:
    """Audio duration in seconds, read from the mp3 header."""

    # Raises where mp3.read_duration reports None: callers divide by the duration to
    # pick a chunk count, so an unreadable file has to stop the step, not yield zero.
    duration = read_duration(Path(audio_path))
    if duration is None:
        raise CodedError(
            f"could not read an mp3 duration from {audio_path}",
            "unreadable_audio",
            file=Path(audio_path).name,
        )
    return duration


def chunk_count(duration: float) -> int:
    """How many overlapping chunks cover `duration`; the last one may run short."""

    step = CHUNK_SECONDS - OVERLAP_SECONDS
    return max(1, math.ceil((duration - OVERLAP_SECONDS) / step))


def split_one_chunk(audio_path: str, tmpdir: str, start: float, length: float) -> str:
    """Copy one mp3 chunk's frames out of the audio without re-encoding; Groq caps a
    request at 25 MB."""

    chunk_path = os.path.join(tmpdir, "chunk.mp3")
    run_ffmpeg(
        [
            "-y",
            "-ss",
            str(start),
            "-i",
            audio_path,
            "-t",
            str(length),
            "-c",
            "copy",
            chunk_path,
        ]
    )
    return chunk_path


def keep_chunk_text(segments: list, index: int, total: int) -> str:
    """The text of chunk `index`'s segments whose midpoint falls in its own share of the
    audio — overlaps are split at their middle, so each boundary segment is kept once."""

    step = CHUNK_SECONDS - OVERLAP_SECONDS
    lo = index * step + OVERLAP_SECONDS / 2 if index > 0 else -math.inf
    hi = (index + 1) * step + OVERLAP_SECONDS / 2 if index < total - 1 else math.inf
    kept = []
    for seg in segments:
        mid = index * step + (seg["start"] + seg["end"]) / 2
        if lo <= mid < hi:
            kept.append(seg["text"].strip())
    return " ".join(t for t in kept if t)


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
    total_chunks = chunk_count(get_duration(audio_path))

    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if (
                meta.get("audio_size") == stat.st_size
                and meta.get("audio_mtime") == stat.st_mtime
                and meta.get("chunk_seconds") == CHUNK_SECONDS
                and meta.get("overlap_seconds") == OVERLAP_SECONDS
                and meta.get("total_chunks") == total_chunks
                and isinstance(meta.get("completed_chunks"), int)
                and 0 <= meta["completed_chunks"] <= total_chunks
            ):
                return {
                    "completed_chunks": meta["completed_chunks"],
                    "total_chunks": total_chunks,
                    "fresh": False,
                }
        except (json.JSONDecodeError, OSError):
            pass

    partial_path.unlink(missing_ok=True)
    meta_path.unlink(missing_ok=True)
    return {
        "completed_chunks": 0,
        "total_chunks": total_chunks,
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
        raise CodedError(
            "GROQ_API_KEY is not set in the environment",
            "missing_api_key",
            provider="groq",
        )
    client = Groq(api_key=api_key, base_url=providers.base_url("groq"))
    lecture_dir = Path(audio_path).parent
    partial_path = lecture_dir / PARTIAL_TXT
    stat = os.stat(audio_path)

    state = _load_resume_state(audio_path)
    completed = state["completed_chunks"]
    total = state["total_chunks"]

    if state["fresh"]:
        partial_path.write_text("", encoding="utf-8")
        _write_meta_atomic(
            lecture_dir,
            {
                "audio_size": stat.st_size,
                "audio_mtime": stat.st_mtime,
                "chunk_seconds": CHUNK_SECONDS,
                "overlap_seconds": OVERLAP_SECONDS,
                "completed_chunks": 0,
                "total_chunks": total,
            },
        )

    duration = get_duration(audio_path)
    log.info(
        f"Duration: {duration / 60:.1f} min → {total} chunks (resuming from {completed})"
    )
    log.info("Transcribing with Groq (whisper-large-v3, Hebrew)...")

    with tempfile.TemporaryDirectory() as tmpdir:
        for i in range(completed, total):
            log.info(f"chunk {i + 1}/{total}")
            try:
                start = i * (CHUNK_SECONDS - OVERLAP_SECONDS)
                chunk_path = split_one_chunk(audio_path, tmpdir, start, CHUNK_SECONDS)
                with open(chunk_path, "rb") as f:
                    response = client.audio.transcriptions.create(
                        model="whisper-large-v3",
                        file=f,
                        language="he",
                        response_format="verbose_json",
                    )
            except groq.RateLimitError as e:
                msg = _extract_groq_message(e)
                info = parse_rate_limit_message(msg)
                info["completed_chunks"] = i
                info["total_chunks"] = total
                raise TranscribeRateLimitError(info) from e
            except (groq.AuthenticationError, groq.PermissionDeniedError) as e:
                raise CodedError(
                    "Groq rejected the API key", "api_key_rejected", provider="groq"
                ) from e
            except Exception as e:
                raise CodedError(str(e), "transcription_failed", detail=str(e)) from e

            # Segments ride as an extra field the SDK's Transcription model doesn't declare.
            text = keep_chunk_text(
                response.model_dump().get("segments") or [], i, total
            )
            with open(partial_path, "a", encoding="utf-8") as f:
                f.write(text + "\n\n")
                f.flush()
                os.fsync(f.fileno())

            _write_meta_atomic(
                lecture_dir,
                {
                    "audio_size": stat.st_size,
                    "audio_mtime": stat.st_mtime,
                    "chunk_seconds": CHUNK_SECONDS,
                    "overlap_seconds": OVERLAP_SECONDS,
                    "completed_chunks": i + 1,
                    "total_chunks": total,
                },
            )

    return partial_path.read_text(encoding="utf-8").strip()
