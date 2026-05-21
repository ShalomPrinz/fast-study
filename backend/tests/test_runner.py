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


# ---- _scheduled_resume guard ----

def test_scheduled_resume_skips_when_locked():
    """_scheduled_resume must not call scan_pending or resume_all if already running."""
    scan_calls: list = []

    async def go():
        runner._resume_status["running"] = True
        try:
            with patch.object(runner, "scan_pending", side_effect=lambda: scan_calls.append(1)):
                await runner._scheduled_resume()
        finally:
            runner._resume_status["running"] = False

    asyncio.run(go())
    assert scan_calls == [], "scan_pending should not be called while resume is running"


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
