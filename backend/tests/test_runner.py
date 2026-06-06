import asyncio
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import runner


def _files(**existing) -> dict:
    """Build a {filename: {exists: bool}} mapping. Pass kwargs like video=True."""
    name_map = {
        "video":      "video.mp4",
        "audio":      "audio.mp3",
        "transcript": "transcript.txt",
        "summary":    "summary.md",
        "pdf":        "summary.pdf",
        "drive":      "drive_url.txt",
    }
    return {fname: {"exists": existing.get(short, False)} for short, fname in name_map.items()}


# ---- next_step ----

def test_next_step_drive_present_returns_none():
    assert runner.next_step(_files(video=True, audio=True, transcript=True, summary=True, pdf=True, drive=True)) is None


def test_next_step_audio_present_transcript_missing_returns_transcribe():
    assert runner.next_step(_files(video=True, audio=True)) == "transcribe"


def test_next_step_only_video_returns_audio():
    assert runner.next_step(_files(video=True)) == "audio"


def test_next_step_summary_present_pdf_missing_returns_pdf():
    assert runner.next_step(_files(video=True, audio=True, transcript=True, summary=True)) == "pdf"


def test_next_step_pdf_present_drive_missing_returns_drive():
    assert runner.next_step(_files(video=True, audio=True, transcript=True, summary=True, pdf=True)) == "drive"


# ---- scan_pending ----

def test_scan_pending_filters_no_video_and_finished():
    tree = [{
        "name": "C1",
        "lectures": [
            {"name": "L_done",      "files": _files(video=True, drive=True)},
            {"name": "L_pending",   "files": _files(video=True, audio=True)},
            {"name": "L_no_video",  "files": _files()},
        ],
        "recitations": [
            {"name": "R_pending",   "files": _files(video=True)},
            {"name": "R_done",      "files": _files(video=True, drive=True)},
        ],
    }]
    with patch.object(runner.db_client, "get_tree", return_value=tree):
        result = asyncio.run(runner.scan_pending())
    assert ("C1", "L_pending", "lecture") in result
    assert ("C1", "R_pending", "recitation") in result
    assert ("C1", "L_done", "lecture") not in result
    assert ("C1", "L_no_video", "lecture") not in result
    assert ("C1", "R_done", "recitation") not in result
    assert len(result) == 2


# ---- _scheduled_run guard ----

def test_scheduled_run_skips_when_locked():
    """_scheduled_run must not call scan_pending or run_all if already running."""
    scan_calls: list = []

    async def go():
        runner._runner_status["running"] = True
        try:
            with patch.object(runner, "scan_pending", side_effect=lambda: scan_calls.append(1)):
                await runner._scheduled_run()
        finally:
            runner._runner_status["running"] = False

    asyncio.run(go())
    assert scan_calls == [], "scan_pending should not be called while runner is running"


# ---- empty-file guard ----

def test_require_nonempty_raises_on_empty():
    with pytest.raises(RuntimeError, match="is empty"):
        runner._require_nonempty("summary.md", b"")


def test_require_nonempty_allows_content():
    runner._require_nonempty("summary.md", b"x")  # no raise


def test_require_nonempty_appends_known_cause():
    """For a known file, the message borrows EMPTY_FILE_ISSUES for the 'why'
    (no exception was raised by the failing tool to derive it from)."""
    with pytest.raises(RuntimeError, match="summary.md is empty — Gemini returned no text"):
        runner._require_nonempty("summary.md", b"")


def test_require_nonempty_unknown_file_is_generic():
    """An unmapped filename gets the bare 'is empty' with no trailing hint."""
    with pytest.raises(RuntimeError) as exc:
        runner._require_nonempty("mystery.bin", b"")
    assert str(exc.value) == "mystery.bin is empty"


def test_db_workspace_rejects_empty_upload():
    """Output side: the shared upload path (audio/pdf/drive) must refuse a 0-byte
    output and never write it to the database service."""
    with patch.object(runner.db_client, "put_file_bytes") as put:
        with pytest.raises(RuntimeError, match="is empty"):
            with runner._db_workspace("C1", "L1", "lecture", upload=["audio.mp3"]) as ws:
                ws["audio.mp3"].write_bytes(b"")
    put.assert_not_called()


def test_db_workspace_allows_nonempty_upload():
    with patch.object(runner.db_client, "put_file_bytes") as put:
        with runner._db_workspace("C1", "L1", "lecture", upload=["audio.mp3"]) as ws:
            ws["audio.mp3"].write_bytes(b"data")
    put.assert_called_once()


def test_db_workspace_rejects_empty_download():
    """Input side: a 0-byte prerequisite halts the step before it runs, so the
    body of the `with` never executes."""
    entered = {"yes": False}
    with patch.object(runner.db_client, "get_file_bytes", return_value=b""):
        with pytest.raises(RuntimeError, match="transcript.txt is empty"):
            with runner._db_workspace("C1", "L1", "lecture", download=["transcript.txt"]):
                entered["yes"] = True
    assert entered["yes"] is False


def test_exec_transcribe_rejects_empty_transcript():
    """An empty Whisper result must halt the step, not write a 0-byte transcript."""
    with patch.object(runner.db_client, "file_exists", return_value=True), \
         patch.object(runner.db_client, "get_file_bytes", return_value=b"audio"), \
         patch.object(runner, "transcribe_audio", return_value=""), \
         patch.object(runner.db_client, "put_file_bytes") as put:
        result = runner._exec_transcribe("C1", "L1", "lecture")
    assert result["status"] == "error"
    assert "transcript.txt is empty" in result["message"]
    # transcript.txt must never be written; only partial files may be touched.
    assert all(c.args[3] != "transcript.txt" for c in put.call_args_list)


def test_exec_summarize_rejects_empty_summary():
    """Output guard: an empty Gemini response is rejected with its known cause,
    and no 0-byte summary.md is written."""
    def _exists(course, lecture, kind, name):
        return name == "transcript.txt"  # transcript present, material absent

    with patch.object(runner.db_client, "file_exists", side_effect=_exists), \
         patch.object(runner.db_client, "get_file_bytes", return_value=b"transcript"), \
         patch.object(runner, "summarize", return_value=""), \
         patch.object(runner.db_client, "put_summary") as put_summary:
        result = runner._exec_summarize("C1", "L1", "lecture")
    assert result["status"] == "error"
    assert "summary.md is empty — Gemini returned no text" in result["message"]
    put_summary.assert_not_called()


# ---- rate-limit branch ----

def test_rate_limit_sleeps_then_retries_same_step():
    """patch _call_step to return rate_limited then done; patch _fetch_files to
    show audio present (so next_step → transcribe), then all done after.
    Assert: same step called twice; asyncio.sleep called with 3600."""

    call_log: list[str] = []
    sleep_log: list[float] = []

    # In the new architecture _run_step_unlocked retries the same step internally
    # (without re-fetching files), so _fetch_files is called once per outer pipeline
    # loop iteration — not once per attempt. Two states suffice: audio-only before
    # the first outer loop, fully-done after the step completes.
    file_states = [
        _files(video=True, audio=True),
        _files(video=True, audio=True, transcript=True, summary=True, pdf=True, drive=True),
    ]
    state_idx = {"i": 0}

    async def fake_fetch(course, lecture, kind):
        i = state_idx["i"]
        state_idx["i"] += 1
        return file_states[min(i, len(file_states) - 1)]

    async def fake_call(course, lecture, kind, step):
        call_log.append(step)
        if len(call_log) == 1:
            return {"status": "rate_limited", "rateLimit": {}, "progress": {}}
        return {"status": "done"}

    async def fake_sleep(seconds):
        sleep_log.append(seconds)

    with patch.object(runner, "_fetch_files", fake_fetch), \
         patch.object(runner, "_call_step", fake_call), \
         patch.object(runner.asyncio, "sleep", fake_sleep):
        asyncio.run(runner.run_pipeline_for("C1", "L1", "lecture"))

    assert call_log == ["transcribe", "transcribe"]
    assert sleep_log == [runner.RATE_LIMIT_SLEEP_SECONDS]
