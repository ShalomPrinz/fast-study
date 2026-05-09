import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from transcribe import (
    PARTIAL_META,
    PARTIAL_TXT,
    _load_resume_state,
    parse_rate_limit_message,
)


GROQ_429_MESSAGE = (
    "Rate limit reached for model `whisper-large-v3` in organization "
    "`org_01kqa6gm4behr9sv6rr3fqkxw9` service tier `on_demand` on seconds of "
    "audio per hour (ASPH): Limit 7200, Used 7019, Requested 600. Please try "
    "again in 3m29.5s. Need more tokens? Upgrade to Dev Tier today at "
    "https://console.groq.com/settings/billing"
)


def test_parse_rate_limit_message_full():
    info = parse_rate_limit_message(GROQ_429_MESSAGE)
    assert info["limit"] == 7200
    assert info["used"] == 7019
    assert info["requested"] == 600
    assert info["retry_after_seconds"] == pytest.approx(209.5)
    assert info["upgrade_url"] == "https://console.groq.com/settings/billing"
    assert info["message"] == GROQ_429_MESSAGE


def test_parse_rate_limit_message_seconds_only():
    info = parse_rate_limit_message("try again in 12s")
    assert info["retry_after_seconds"] == pytest.approx(12.0)
    assert info["limit"] is None
    assert info["upgrade_url"] is None


def test_parse_rate_limit_message_empty():
    info = parse_rate_limit_message("")
    assert info["limit"] is None
    assert info["used"] is None
    assert info["requested"] is None
    assert info["retry_after_seconds"] is None
    assert info["upgrade_url"] is None
    assert info["message"] == ""


def _make_audio(tmp_path: Path, size: int = 1024) -> Path:
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"\x00" * size)
    return audio


def _write_meta(tmp_path: Path, **overrides):
    audio = tmp_path / "audio.mp3"
    stat = audio.stat()
    meta = {
        "audio_size": stat.st_size,
        "audio_mtime": stat.st_mtime,
        "chunk_seconds": 600,
        "completed_chunks": 3,
        "total_chunks": 12,
    }
    meta.update(overrides)
    (tmp_path / PARTIAL_META).write_text(json.dumps(meta))
    (tmp_path / PARTIAL_TXT).write_text("partial text\n\n")


def test_load_resume_state_resumes_when_meta_matches(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path)

    with patch("transcribe.get_duration", return_value=12 * 600):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is False
    assert state["completed_chunks"] == 3
    assert state["total_chunks"] == 12
    assert state["chunk_seconds"] == 600
    assert (tmp_path / PARTIAL_TXT).exists()
    assert (tmp_path / PARTIAL_META).exists()


def test_load_resume_state_wipes_on_size_mismatch(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path, audio_size=999999)

    with patch("transcribe.get_duration", return_value=12 * 600):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True
    assert state["completed_chunks"] == 0
    assert not (tmp_path / PARTIAL_TXT).exists()
    assert not (tmp_path / PARTIAL_META).exists()


def test_load_resume_state_wipes_on_mtime_mismatch(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path, audio_mtime=1.0)

    with patch("transcribe.get_duration", return_value=12 * 600):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True
    assert not (tmp_path / PARTIAL_TXT).exists()


def test_load_resume_state_wipes_on_total_chunks_mismatch(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path, total_chunks=5)

    with patch("transcribe.get_duration", return_value=12 * 600):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True


def test_load_resume_state_no_meta_is_fresh(tmp_path):
    audio = _make_audio(tmp_path)
    with patch("transcribe.get_duration", return_value=12 * 600):
        state = _load_resume_state(str(audio))
    assert state["fresh"] is True
    assert state["total_chunks"] == 12


def test_load_resume_state_corrupt_meta_is_fresh(tmp_path):
    audio = _make_audio(tmp_path)
    (tmp_path / PARTIAL_META).write_text("not json")
    (tmp_path / PARTIAL_TXT).write_text("garbage")

    with patch("transcribe.get_duration", return_value=12 * 600):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True
    assert not (tmp_path / PARTIAL_META).exists()
    assert not (tmp_path / PARTIAL_TXT).exists()
