import asyncio
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline import runner


def _files(**existing) -> dict:
    """Build a {filename: {exists: bool}} mapping. Pass kwargs like video=True."""
    name_map = {
        "video": "video.mp4",
        "audio": "audio.mp3",
        "transcript": "transcript.txt",
        "summary": "summary.md",
        "pdf": "summary.pdf",
        "drive": "drive_url.txt",
    }
    return {
        fname: {"exists": existing.get(short, False)}
        for short, fname in name_map.items()
    }


# Every case below describes the full five-step order; TestDriveDisabled owns the other one.
@pytest.fixture(autouse=True)
def _drive_on(monkeypatch):
    monkeypatch.setenv("DRIVE_ENABLED", "true")


class TestDriveDisabled:
    """With DRIVE_ENABLED off a lecture is complete at summary.pdf — otherwise it stays
    pending forever and the runner loops on it."""

    @pytest.fixture(autouse=True)
    def _drive_off(self, monkeypatch):
        monkeypatch.setenv("DRIVE_ENABLED", "false")

    def test_enabled_steps_drops_drive(self):
        assert runner.enabled_steps() == ["audio", "transcribe", "summarize", "pdf"]
        assert runner.final_output() == "summary.pdf"

    def test_next_step_pdf_present_returns_none(self):
        files = _files(video=True, audio=True, transcript=True, summary=True, pdf=True)
        assert runner.next_step(files) is None

    def test_next_step_still_advances_to_pdf(self):
        files = _files(video=True, audio=True, transcript=True, summary=True)
        assert runner.next_step(files) == "pdf"

    def test_lecture_with_pdf_is_not_pending(self):
        files = _files(video=True, audio=True, transcript=True, summary=True, pdf=True)
        assert runner._lecture_pending(files) is False
        assert runner._lecture_pending(_files(video=True, summary=True)) is True


def test_enabled_steps_includes_drive_when_on():
    assert runner.enabled_steps() == runner.STEP_ORDER
    assert runner.final_output() == "drive_url.txt"


# ---- next_step ----


def test_next_step_drive_present_returns_none():
    assert (
        runner.next_step(
            _files(
                video=True,
                audio=True,
                transcript=True,
                summary=True,
                pdf=True,
                drive=True,
            )
        )
        is None
    )


def test_next_step_audio_present_transcript_missing_returns_transcribe():
    assert runner.next_step(_files(video=True, audio=True)) == "transcribe"


def test_next_step_only_video_returns_audio():
    assert runner.next_step(_files(video=True)) == "audio"


def test_next_step_summary_present_pdf_missing_returns_pdf():
    assert (
        runner.next_step(_files(video=True, audio=True, transcript=True, summary=True))
        == "pdf"
    )


def test_next_step_pdf_present_drive_missing_returns_drive():
    assert (
        runner.next_step(
            _files(video=True, audio=True, transcript=True, summary=True, pdf=True)
        )
        == "drive"
    )


# ---- scan_pending ----


def test_scan_pending_filters_no_video_and_finished():
    tree = [
        {
            "name": "C1",
            "lectures": [
                {"name": "L_done", "files": _files(video=True, drive=True)},
                {"name": "L_pending", "files": _files(video=True, audio=True)},
                {"name": "L_no_video", "files": _files()},
            ],
            "recitations": [
                {"name": "R_pending", "files": _files(video=True)},
                {"name": "R_done", "files": _files(video=True, drive=True)},
            ],
        }
    ]
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
            with patch.object(
                runner, "scan_pending", side_effect=lambda: scan_calls.append(1)
            ):
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
    with pytest.raises(
        RuntimeError, match="summary.md is empty — Gemini returned no text"
    ):
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
            with runner._db_workspace(
                "C1", "L1", "lecture", upload=["audio.mp3"]
            ) as ws:
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
            with runner._db_workspace(
                "C1", "L1", "lecture", download=["transcript.txt"]
            ):
                entered["yes"] = True
    assert entered["yes"] is False


def test_exec_transcribe_rejects_empty_transcript():
    """An empty Whisper result must halt the step, not write a 0-byte transcript."""
    with (
        patch.object(runner.db_client, "file_exists", return_value=True),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"audio"),
        patch.object(runner, "transcribe_audio", return_value=""),
        patch.object(runner.db_client, "put_file_bytes") as put,
    ):
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

    with (
        patch.object(runner.db_client, "file_exists", side_effect=_exists),
        patch.object(runner.db_client, "list_materials", return_value=[]),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"transcript"),
        patch.object(runner, "summarize", return_value=""),
        patch.object(runner.db_client, "put_summary") as put_summary,
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    assert result["status"] == "error"
    assert "summary.md is empty — Gemini returned no text" in result["message"]
    put_summary.assert_not_called()


# ---- summarize: material PDFs ----


def _run_exec_summarize_with_materials(contents: dict[str, bytes]) -> tuple[dict, dict]:
    """Run _exec_summarize against a fake material listing ({name: bytes}, listing order),
    capturing what reached summarize()."""
    seen: dict = {}

    def _fake_summarize(transcript_path, material_paths):
        seen["names"] = [p.name for p in material_paths]
        seen["bytes"] = [p.read_bytes() for p in material_paths]
        seen["dir"] = transcript_path.parent
        return "# summary"

    with (
        patch.object(runner.db_client, "file_exists", return_value=True),
        patch.object(
            runner.db_client,
            "list_materials",
            return_value=[{"name": n, "size": len(b)} for n, b in contents.items()],
        ),
        patch.object(
            runner.db_client,
            "get_file_bytes",
            side_effect=lambda c, l, k, name: contents.get(name, b"transcript"),
        ),
        patch.object(runner, "summarize", side_effect=_fake_summarize),
        patch.object(runner.db_client, "put_summary"),
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    return result, seen


def test_exec_summarize_no_materials():
    result, seen = _run_exec_summarize_with_materials({})
    assert result == {"status": "done", "usedMaterial": False}
    assert seen["names"] == []


def test_exec_summarize_single_material():
    result, seen = _run_exec_summarize_with_materials({"material.pdf": b"%PDF-a"})
    assert result == {"status": "done", "usedMaterial": True}
    assert seen["names"] == ["material.pdf"]
    assert seen["bytes"] == [b"%PDF-a"]


def test_exec_summarize_several_materials():
    """Every listed material is downloaded and handed to Gemini, in listing order."""
    result, seen = _run_exec_summarize_with_materials(
        {
            "material.pdf": b"%PDF-a",
            "material.2.pdf": b"%PDF-b",
            "material.3.pdf": b"%PDF-c",
        }
    )
    assert result == {"status": "done", "usedMaterial": True}
    assert seen["names"] == ["material.pdf", "material.2.pdf", "material.3.pdf"]
    assert seen["bytes"] == [b"%PDF-a", b"%PDF-b", b"%PDF-c"]


def test_exec_summarize_skips_empty_material():
    """An empty material is dropped, not fatal — the rest still reach Gemini."""
    result, seen = _run_exec_summarize_with_materials(
        {"material.pdf": b"", "material.2.pdf": b"%PDF-b"}
    )
    assert result == {"status": "done", "usedMaterial": True}
    assert seen["names"] == ["material.2.pdf"]


def test_exec_summarize_all_materials_empty_runs_transcript_only():
    result, seen = _run_exec_summarize_with_materials(
        {"material.pdf": b"", "material.2.pdf": b""}
    )
    assert result == {"status": "done", "usedMaterial": False}
    assert seen["names"] == []


# ---- transcribe partial persistence ----


def _fake_transcribe_writing_partial(exc):
    """Return a transcribe_audio stand-in that writes partial files into the workspace
    (mimicking chunks completed this run) and then raises `exc`."""

    def _fake(audio_path):
        d = Path(audio_path).parent
        (d / runner.PARTIAL_TXT).write_text("chunk 1 text\n\n")
        (d / runner.PARTIAL_META).write_text(
            '{"completed_chunks": 1, "total_chunks": 9}'
        )
        raise exc

    return _fake


def test_exec_transcribe_persists_partial_on_generic_error():
    """A non-rate-limit failure (e.g. Groq HTTP 500 after the SDK's own retries) must
    still upload the partial so the next attempt resumes instead of restarting at 0."""
    puts: list[str] = []

    def _exists(course, lecture, kind, name):
        return name == "audio.mp3"  # only audio present; no prior partial to restore

    with (
        patch.object(runner.db_client, "file_exists", side_effect=_exists),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"audio-bytes"),
        patch.object(
            runner.db_client,
            "put_file_bytes",
            side_effect=lambda c, l, k, n, d: puts.append(n),
        ),
        patch.object(
            runner,
            "transcribe_audio",
            side_effect=_fake_transcribe_writing_partial(
                RuntimeError("Internal Server Error")
            ),
        ),
    ):
        result = runner._exec_transcribe("C1", "L1", "lecture")

    assert result["status"] == "error"
    assert "Internal Server Error" in result["message"]
    assert runner.PARTIAL_TXT in puts and runner.PARTIAL_META in puts
    assert (
        "transcript.txt" not in puts
    )  # a failed run must never write the final transcript


def test_exec_transcribe_persists_partial_on_rate_limit():
    """Regression for the _persist_transcribe_partial refactor: the rate-limit branch
    still round-trips the partial and reports progress."""
    puts: list[str] = []
    err = runner.TranscribeRateLimitError({"completed_chunks": 1, "total_chunks": 9})

    def _exists(course, lecture, kind, name):
        return name == "audio.mp3"

    with (
        patch.object(runner.db_client, "file_exists", side_effect=_exists),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"audio-bytes"),
        patch.object(
            runner.db_client,
            "put_file_bytes",
            side_effect=lambda c, l, k, n, d: puts.append(n),
        ),
        patch.object(
            runner,
            "transcribe_audio",
            side_effect=_fake_transcribe_writing_partial(err),
        ),
    ):
        result = runner._exec_transcribe("C1", "L1", "lecture")

    assert result["status"] == "rate_limited"
    assert result["progress"] == {"completed": 1, "total": 9}
    assert runner.PARTIAL_TXT in puts and runner.PARTIAL_META in puts


# ---- error is logged, not just stored ----


def test_run_step_logs_error(caplog):
    """An error outcome is logged (not only stored in _errors), so the terminal shows
    the failure instead of a silent jump to the next lecture."""

    async def fake_call(course, lecture, kind, step):
        return {"status": "error", "message": "boom"}

    async def go():
        with (
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            await runner._run_step_unlocked("C1", "L1", "lecture", "transcribe")

    with caplog.at_level("ERROR", logger="runner"):
        asyncio.run(go())

    skey = runner._skey("C1", "L1", "lecture")
    stored = runner._errors.pop(skey, None)  # capture + clean up module-global state
    assert stored == "boom"
    assert any("step transcribe failed" in r.getMessage() for r in caplog.records)


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
        _files(
            video=True, audio=True, transcript=True, summary=True, pdf=True, drive=True
        ),
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

    with (
        patch.object(runner, "_fetch_files", fake_fetch),
        patch.object(runner, "_call_step", fake_call),
        patch.object(runner.asyncio, "sleep", fake_sleep),
    ):
        asyncio.run(runner.run_pipeline_for("C1", "L1", "lecture"))

    assert call_log == ["transcribe", "transcribe"]
    assert sleep_log == [runner.RATE_LIMIT_SLEEP_SECONDS]


def test_rate_limit_honors_per_result_retry_after():
    """A rate_limited result may carry its own retry_after; the 3600s constant is
    only the fallback, which is what transcribe uses."""
    sleep_log: list[float] = []
    calls = {"n": 0}

    async def fake_call(course, lecture, kind, step):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"status": "rate_limited", "retry_after": 42.0}
        return {"status": "done"}

    async def fake_sleep(seconds):
        sleep_log.append(seconds)

    async def go():
        with (
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
            patch.object(runner.asyncio, "sleep", fake_sleep),
        ):
            await runner._run_step_unlocked("C1", "L1", "lecture", "summarize")

    asyncio.run(go())
    assert sleep_log == [42.0]


# ---- Gemini 429 → step result ----


def _run_exec_summarize(info: dict) -> dict:
    """Run _exec_summarize with the transcript present and Gemini raising a 429."""
    err = runner.GeminiRateLimitError({**info, "message": "quota message"})

    def _exists(course, lecture, kind, name):
        return name == "transcript.txt"  # transcript present, material absent

    with (
        patch.object(runner.db_client, "file_exists", side_effect=_exists),
        patch.object(runner.db_client, "list_materials", return_value=[]),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"transcript"),
        patch.object(runner.db_client, "put_summary") as put_summary,
        patch.object(runner, "summarize", side_effect=err),
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    put_summary.assert_not_called()
    return result


def test_exec_summarize_per_minute_quota_is_rate_limited():
    """A per-minute quota waits out its window, not Groq's hour."""
    result = _run_exec_summarize({"is_daily": False})
    assert result["status"] == "rate_limited"
    assert result["retry_after"] == runner.GEMINI_MINUTE_QUOTA_SLEEP_SECONDS


def test_exec_summarize_daily_quota_is_error_not_retried():
    """A daily quota is a plain flagged error — its retryDelay lies, so no retry."""
    result = _run_exec_summarize({"is_daily": True})
    assert result["status"] == "error"
    assert result["daily_quota"] is True
    assert result["message"] == "quota message"


# ---- Gemini daily-quota block ----


def _quota_error_result(
    message="Gemini free-tier daily quota reached (20 requests/day) — resets at midnight Pacific",
):
    return {"status": "error", "message": message, "daily_quota": True}


def test_daily_quota_blocks_summarize_for_later_lectures_without_extra_errors():
    """First lecture records the real error and halts; every later lecture stops
    silently at transcript.txt — one error in the UI, not N identical ones."""
    steps_run: list[tuple[str, str]] = []
    queue = [("C1", "L1", "lecture"), ("C1", "L2", "lecture"), ("C1", "L3", "lecture")]

    async def fake_fetch(course, lecture, kind):
        # Everything is transcribed already, so next_step is always summarize
        # until summary.md exists (it never does here).
        return _files(video=True, audio=True, transcript=True)

    async def fake_call(course, lecture, kind, step):
        steps_run.append((lecture, step))
        return _quota_error_result()

    async def go():
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            return await runner.run_all(queue)

    try:
        asyncio.run(go())
        assert steps_run == [("L1", "summarize")], (
            "only the first lecture may call Gemini"
        )
        assert list(runner._errors) == [runner._skey("C1", "L1", "lecture")]
        assert (
            "daily quota reached" in runner._errors[runner._skey("C1", "L1", "lecture")]
        )
    finally:
        runner._errors.clear()
        runner._summarize_blocked = False


def test_daily_quota_block_is_cleared_and_bypassed_by_manual_runs():
    """run_all clears the flag in its finally; a manual /pipeline trigger never
    consults it (the user may have swapped keys since)."""
    calls: list[str] = []

    async def fake_fetch(course, lecture, kind):
        return _files(video=True, audio=True, transcript=True)

    async def fake_call(course, lecture, kind, step):
        calls.append(step)
        return _quota_error_result()

    async def go():
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            await runner.run_all([("C1", "L1", "lecture")])
            assert runner._summarize_blocked is False  # cleared by run_all's finally
            runner._summarize_blocked = True  # as if a run were still blocked
            await runner.run_pipeline_for("C1", "L2", "lecture")

    try:
        asyncio.run(go())
        assert calls == ["summarize", "summarize"]
    finally:
        runner._errors.clear()
        runner._summarize_blocked = False


class TestDropInFlight:
    """drop_in_flight filters the scanned queue by the per-lecture locks."""

    def test_keeps_unlocked_and_drops_locked(self):
        async def go():
            queue = [("C1", "L1", "lecture"), ("C1", "L2", "lecture")]
            held = runner._locks.setdefault(
                runner._lkey("C1", "L1", "lecture"), asyncio.Lock()
            )
            async with held:
                assert runner.drop_in_flight(queue) == [("C1", "L2", "lecture")]
            # lock released → both come back
            assert runner.drop_in_flight(queue) == queue

        try:
            asyncio.run(go())
        finally:
            runner._locks.clear()

    def test_all_locked_yields_empty_queue(self):
        async def go():
            queue = [("C1", "L1", "lecture"), ("C1", "R1", "recitation")]
            locks = [
                runner._locks.setdefault(runner._lkey(*entry), asyncio.Lock())
                for entry in queue
            ]
            for lock in locks:
                await lock.acquire()
            try:
                assert runner.drop_in_flight(queue) == []
            finally:
                for lock in locks:
                    lock.release()

        try:
            asyncio.run(go())
        finally:
            runner._locks.clear()

    def test_empty_queue_stays_empty(self):
        assert runner.drop_in_flight([]) == []


# ---- _exec_pdf: the .pdf_warning / .pdf_build.tex dotfiles ----


class _PdfDb:
    """Records the db_client calls _exec_pdf makes around a render."""

    def __init__(self):
        self.puts: list[str] = []
        self.deletes: list[str] = []
        self.notifies = 0
        self.stored: dict[str, bytes] = {}
        self.delete_raises = False

    def install(self, stack, convert):
        stack.enter_context(
            patch.object(runner.db_client, "file_exists", lambda *a: True)
        )
        stack.enter_context(
            patch.object(runner.db_client, "get_summary", lambda *a: "# summary\n")
        )
        stack.enter_context(patch.object(runner.db_client, "put_file_bytes", self._put))
        stack.enter_context(patch.object(runner.db_client, "delete_file", self._delete))
        stack.enter_context(patch.object(runner.db_client, "notify", self._notify))
        stack.enter_context(patch.object(runner, "convert_to_pdf", convert))

    def _put(self, course, lecture, kind, name, data):
        self.puts.append(name)
        self.stored[name] = data

    def _delete(self, course, lecture, kind, name):
        self.deletes.append(name)
        if self.delete_raises:
            raise RuntimeError("database service is down")

    def _notify(self):
        self.notifies += 1


def _run_exec_pdf(convert, delete_raises=False) -> tuple[dict, _PdfDb]:
    db = _PdfDb()
    db.delete_raises = delete_raises
    with ExitStack() as stack:
        db.install(stack, convert)
        result = runner._exec_pdf("C1", "L1", "lecture")
    return result, db


def _fake_render(warning=None):
    def convert(md_path):
        out = Path(md_path).with_suffix(".pdf")
        out.write_bytes(b"%PDF-1.4 stub")
        return str(out), warning

    return convert


def test_exec_pdf_writes_warning_and_still_reports_done():
    """A recovered render must not stop the pipeline — drive still has to run."""

    result, db = _run_exec_pdf(_fake_render("LaTeX error: Missing $ inserted (line 7)"))
    assert result == {"status": "done"}
    assert (
        db.stored[runner.PDF_WARNING_FILE]
        == b"LaTeX error: Missing $ inserted (line 7)"
    )
    assert db.notifies == 1


def test_exec_pdf_warning_is_written_after_the_pdf_upload():
    """A warning may never exist without the PDF it describes."""

    _, db = _run_exec_pdf(_fake_render("LaTeX error: boom"))
    assert db.puts == ["summary.pdf", runner.PDF_WARNING_FILE]


def test_exec_pdf_clean_render_clears_both_stale_markers():
    """Neither marker may outlive the build it describes: a .pdf_build.tex kept by an
    EARLIER hard failure would send a later `l.<N>` to the wrong line."""

    result, db = _run_exec_pdf(_fake_render(None))
    assert result == {"status": "done"}
    assert db.deletes == [runner.PDF_WARNING_FILE, runner.PDF_BUILD_TEX_FILE]
    assert runner.PDF_WARNING_FILE not in db.stored
    assert db.notifies == 1


def test_exec_pdf_recovered_render_still_clears_a_stale_build_tex():
    """The warning is kept, but its `l.<N>` indexes THIS build — not the failed one."""

    _, db = _run_exec_pdf(_fake_render("LaTeX error: boom"))
    assert db.deletes == [runner.PDF_BUILD_TEX_FILE]


def test_exec_pdf_hard_failure_stores_the_generated_tex():
    """The `l.<N>` in the message indexes .pdf_build.tex, so it has to be persisted."""

    def convert(md_path):
        raise runner.PdfRenderError(
            "LaTeX error: Undefined control sequence (line 417)",
            tex_source="\\documentclass{article}",
        )

    result, db = _run_exec_pdf(convert)
    assert result["status"] == "error"
    assert db.stored[runner.PDF_BUILD_TEX_FILE] == b"\\documentclass{article}"
    # No PDF was produced, so no warning may be written either.
    assert runner.PDF_WARNING_FILE not in db.stored


def test_exec_pdf_hard_failure_clears_a_stale_warning():
    """Nothing uploads on failure, so an EARLIER recovered render's summary.pdf and its
    warning survive — but the .pdf_build.tex that warning's `l.<N>` indexes is now this
    build's, so the marker has to go."""

    def convert(md_path):
        raise runner.PdfRenderError("LaTeX error: boom (line 9)", tex_source="\\x")

    _, db = _run_exec_pdf(convert)
    assert db.deletes == [runner.PDF_WARNING_FILE]


def test_exec_pdf_failure_with_no_tex_keeps_the_existing_warning():
    """Only overwriting .pdf_build.tex invalidates the old warning. A pandoc failure or a
    timeout carries no .tex, so the surviving summary.pdf keeps its badge."""

    def convert(md_path):
        raise runner.PdfRenderError("pandoc timed out after 60s")

    _, db = _run_exec_pdf(convert)
    assert db.deletes == []


def test_exec_pdf_failed_tex_upload_keeps_the_existing_warning():
    """The old .pdf_build.tex is untouched when the store failed, so the pair still agrees."""

    def convert(md_path):
        raise runner.PdfRenderError("LaTeX error: boom (line 9)", tex_source="\\x")

    db = _PdfDb()
    with ExitStack() as stack:
        db.install(stack, convert)
        stack.enter_context(
            patch.object(
                runner.db_client,
                "put_file_bytes",
                Mock(side_effect=RuntimeError("database service is down")),
            )
        )
        result = runner._exec_pdf("C1", "L1", "lecture")
    assert result["status"] == "error"
    assert db.deletes == []


def test_exec_pdf_marker_cleanup_failure_does_not_sink_a_good_render():
    """The PDF is already uploaded when the markers are cleared, so a database blip on
    that call must not report a successful render as an error (and skip the notify)."""

    result, db = _run_exec_pdf(_fake_render(None), delete_raises=True)
    assert result == {"status": "done"}
    assert db.deletes == [runner.PDF_WARNING_FILE, runner.PDF_BUILD_TEX_FILE]
    assert db.notifies == 1


def test_exec_pdf_plain_failure_writes_no_dotfiles():
    def convert(md_path):
        raise RuntimeError("pandoc missing")

    result, db = _run_exec_pdf(convert)
    assert result == {"status": "error", "message": "pandoc missing"}
    assert db.stored == {}
