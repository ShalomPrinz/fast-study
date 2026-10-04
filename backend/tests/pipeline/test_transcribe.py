import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import transcribe as transcribe_mod
from transcribe import (
    OVERLAP_SECONDS,
    PARTIAL_META,
    PARTIAL_TXT,
    _load_resume_state,
    chunk_count,
    keep_chunk_text,
    parse_rate_limit_message,
    transcribe_audio,
)


def test_a_missing_groq_key_names_the_provider(monkeypatch, tmp_path):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GROQ_API_KEY") as e:
        transcribe_audio(str(tmp_path / "audio.mp3"))
    assert (e.value.code, e.value.params) == ("missing_api_key", {"provider": "groq"})


def test_a_groq_failure_carries_its_own_text_as_detail(monkeypatch, tmp_path):
    """Whisper's wording is untranslatable, so it rides as `detail` on a code of ours."""

    monkeypatch.setenv("GROQ_API_KEY", "gsk_x")
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"\x00" * 64)
    client = MagicMock()
    client.audio.transcriptions.create.side_effect = Exception("400 invalid file")
    monkeypatch.setattr(transcribe_mod, "Groq", MagicMock(return_value=client))
    monkeypatch.setattr(transcribe_mod, "get_duration", lambda p: 60.0)
    monkeypatch.setattr(transcribe_mod, "split_one_chunk", lambda *a: str(audio))

    with pytest.raises(RuntimeError) as e:
        transcribe_audio(str(audio))
    assert e.value.code == "transcription_failed"
    assert e.value.params == {"detail": "400 invalid file"}


@pytest.mark.parametrize(
    ("error_cls", "status"),
    [("AuthenticationError", 401), ("PermissionDeniedError", 403)],
)
def test_a_rejected_groq_key_raises_api_key_rejected(
    monkeypatch, tmp_path, error_cls, status
):
    import groq
    import httpx

    monkeypatch.setenv("GROQ_API_KEY", "gsk_bad")
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"\x00" * 64)
    response = httpx.Response(
        status, request=httpx.Request("POST", "https://api.groq.com/x")
    )
    client = MagicMock()
    client.audio.transcriptions.create.side_effect = getattr(groq, error_cls)(
        "Invalid API Key", response=response, body=None
    )
    monkeypatch.setattr(transcribe_mod, "Groq", MagicMock(return_value=client))
    monkeypatch.setattr(transcribe_mod, "get_duration", lambda p: 60.0)
    monkeypatch.setattr(transcribe_mod, "split_one_chunk", lambda *a: str(audio))

    with pytest.raises(RuntimeError) as e:
        transcribe_audio(str(audio))
    assert (e.value.code, e.value.params) == ("api_key_rejected", {"provider": "groq"})


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


def test_parse_rate_limit_message_seconds_only():
    info = parse_rate_limit_message("try again in 12s")
    assert info["retry_after_seconds"] == pytest.approx(12.0)
    assert info["limit"] is None


def test_parse_rate_limit_message_empty():
    info = parse_rate_limit_message("")
    assert info["limit"] is None
    assert info["used"] is None
    assert info["requested"] is None
    assert info["retry_after_seconds"] is None


# Long enough for exactly 12 overlapping chunks.
DURATION_12 = 11 * 590 + 600


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
        "overlap_seconds": OVERLAP_SECONDS,
        "completed_chunks": 3,
        "total_chunks": 12,
    }
    meta.update(overrides)
    (tmp_path / PARTIAL_META).write_text(json.dumps(meta))
    (tmp_path / PARTIAL_TXT).write_text("partial text\n\n")


def test_load_resume_state_resumes_when_meta_matches(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path)

    with patch("transcribe.get_duration", return_value=DURATION_12):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is False
    assert state["completed_chunks"] == 3
    assert state["total_chunks"] == 12
    assert (tmp_path / PARTIAL_TXT).exists()
    assert (tmp_path / PARTIAL_META).exists()


def test_load_resume_state_wipes_on_size_mismatch(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path, audio_size=999999)

    with patch("transcribe.get_duration", return_value=DURATION_12):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True
    assert state["completed_chunks"] == 0
    assert not (tmp_path / PARTIAL_TXT).exists()
    assert not (tmp_path / PARTIAL_META).exists()


def test_load_resume_state_wipes_on_mtime_mismatch(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path, audio_mtime=1.0)

    with patch("transcribe.get_duration", return_value=DURATION_12):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True
    assert not (tmp_path / PARTIAL_TXT).exists()


def test_load_resume_state_wipes_on_total_chunks_mismatch(tmp_path):
    audio = _make_audio(tmp_path)
    _write_meta(tmp_path, total_chunks=5)

    with patch("transcribe.get_duration", return_value=DURATION_12):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True


def test_load_resume_state_wipes_on_a_meta_without_overlap(tmp_path):
    """A partial cut on hard boundaries can't be continued with overlapping chunks."""

    audio = _make_audio(tmp_path)
    _write_meta(tmp_path, overlap_seconds=None)

    with patch("transcribe.get_duration", return_value=DURATION_12):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True


def test_load_resume_state_no_meta_is_fresh(tmp_path):
    audio = _make_audio(tmp_path)
    with patch("transcribe.get_duration", return_value=DURATION_12):
        state = _load_resume_state(str(audio))
    assert state["fresh"] is True
    assert state["total_chunks"] == 12


def test_load_resume_state_corrupt_meta_is_fresh(tmp_path):
    audio = _make_audio(tmp_path)
    (tmp_path / PARTIAL_META).write_text("not json")
    (tmp_path / PARTIAL_TXT).write_text("garbage")

    with patch("transcribe.get_duration", return_value=DURATION_12):
        state = _load_resume_state(str(audio))

    assert state["fresh"] is True
    assert not (tmp_path / PARTIAL_META).exists()
    assert not (tmp_path / PARTIAL_TXT).exists()


@pytest.mark.parametrize(
    ("duration", "chunks"),
    [(30.0, 1), (600.0, 1), (601.0, 2), (1190.0, 2), (1191.0, 3)],
)
def test_chunk_count_covers_the_audio_with_overlap(duration, chunks):
    assert chunk_count(duration) == chunks


def _seg(start, end, text):
    return {"start": start, "end": end, "text": text}


def test_keep_chunk_text_splits_the_overlap_at_its_middle():
    """Chunk 1 starts at 590 s; the 590–600 overlap is split at 595."""

    first = [_seg(0, 580, " a"), _seg(580, 594, " b"), _seg(594, 600, " c")]
    second = [_seg(0, 4, " b"), _seg(4, 10, " c"), _seg(10, 20, " d")]
    assert keep_chunk_text(first, 0, 2) == "a b"
    assert keep_chunk_text(second, 1, 2) == "c d"


def test_keep_chunk_text_keeps_everything_in_a_single_chunk():
    assert keep_chunk_text([_seg(0, 5, " a"), _seg(5, 9, " b ")], 0, 1) == "a b"


def test_transcribe_merges_overlapping_chunks_without_duplicates(monkeypatch, tmp_path):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_x")
    audio = _make_audio(tmp_path)
    starts = []

    def one_chunk(_audio, _tmpdir, start, _length):
        starts.append(start)
        return str(audio)

    replies = [
        [_seg(0, 592, " first"), _seg(592, 600, " boundary")],
        [_seg(0, 10, " boundary"), _seg(10, 30, " last")],
    ]
    client = MagicMock()
    client.audio.transcriptions.create.side_effect = [
        MagicMock(model_dump=lambda r=r: {"text": "", "segments": r}) for r in replies
    ]
    monkeypatch.setattr(transcribe_mod, "Groq", MagicMock(return_value=client))
    monkeypatch.setattr(transcribe_mod, "get_duration", lambda p: 620.0)
    monkeypatch.setattr(transcribe_mod, "split_one_chunk", one_chunk)

    assert transcribe_audio(str(audio)) == "first\n\nboundary last"
    assert starts == [0, 590]
    kwargs = client.audio.transcriptions.create.call_args.kwargs
    assert (kwargs["language"], kwargs["response_format"]) == ("he", "verbose_json")
