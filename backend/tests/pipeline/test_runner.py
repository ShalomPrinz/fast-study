import asyncio
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

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


def test_next_step_materials_only_skips_audio_and_transcribe():
    assert runner.next_step(_files(), materials_only=True) == "summarize"
    assert runner.next_step(_files(summary=True), materials_only=True) == "pdf"
    assert runner.next_step(_files(summary=True, pdf=True), True) == "drive"
    assert runner.next_step(_files(summary=True, pdf=True, drive=True), True) is None


def test_next_step_without_the_flag_still_starts_at_audio():
    assert runner.next_step(_files()) == "audio"
    assert runner.next_step(_files(summary=True)) == "audio"


def test_is_materials_only():
    pdf = [{"name": "material.pdf", "size": 3}]
    assert runner.is_materials_only(_files(), pdf) is True
    assert runner.is_materials_only(_files(video=True), pdf) is False
    assert runner.is_materials_only(_files(), []) is False
    # Audio with no video is still transcribed, never summarized from the PDFs alone.
    assert runner.is_materials_only(_files(audio=True), pdf) is False


def test_next_step_on_audio_only_lecture_with_materials_is_transcribe():
    files = _files(audio=True)
    pdf = [{"name": "material.pdf", "size": 3}]
    assert runner.next_step(files, runner.is_materials_only(files, pdf)) == "transcribe"


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


def test_scan_pending_ignores_materials_only_lectures():
    """Materials-only summarize is manual: no automatic trigger ever picks one up."""
    tree = [
        {
            "name": "C1",
            "lectures": [
                {
                    "name": "L_slides",
                    "files": _files(),
                    "materials": [{"name": "material.pdf", "size": 3}],
                }
            ],
            "recitations": [],
        }
    ]
    with (
        patch.object(runner.db_client, "get_tree", return_value=tree),
        patch.object(runner.db_client, "list_materials") as list_materials,
    ):
        assert asyncio.run(runner.scan_pending()) == []
    list_materials.assert_not_called()


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


def test_require_nonempty_carries_only_the_filename():
    """One code for all six files: the hint is a sentence fragment and stays in the prose,
    so a renderer keys its own clause off `file` instead."""

    with pytest.raises(runner.CodedError) as exc:
        runner._require_nonempty("summary.md", b"")
    assert exc.value.code == "empty_file"
    assert exc.value.params == {"file": "summary.md"}


def test_every_step_guard_names_the_file_and_its_producing_step():
    """The five guards collapse into one code; `step` is the machine id the producing step
    goes by, never the label the English sentence carries."""

    guards = {
        "audio": ("video.mp4", "download"),
        "transcribe": ("audio.mp3", "audio"),
        "summarize": ("transcript.txt", "transcribe"),
        "pdf": ("summary.md", "summarize"),
        "drive": ("summary.pdf", "pdf"),
    }
    with (
        patch.object(runner.db_client, "file_exists", return_value=False),
        patch.object(runner.db_client, "list_materials", return_value=[]),
    ):
        for step, (file, producer) in guards.items():
            result = runner.execute_step("C1", "L1", "lecture", step)
            assert result["status"] == "error"
            assert result["code"] == "missing_prerequisite"
            assert result["params"] == {"file": file, "step": producer}


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


def test_exec_summarize_writes_its_output_as_a_fresh_summary():
    """New AI output must drop the old revert snapshot, or Restore original brings back a
    previous summary (even a different video's) instead of this one."""

    with (
        patch.object(runner.db_client, "file_exists", return_value=True),
        patch.object(runner.db_client, "list_materials", return_value=[]),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"transcript"),
        patch.object(runner, "summarize", return_value="# new"),
        patch.object(runner.db_client, "put_summary") as put_summary,
    ):
        runner._exec_summarize("C1", "L1", "lecture")
    put_summary.assert_called_once_with("C1", "L1", "lecture", "# new", fresh=True)


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


def test_exec_summarize_records_attached_names_including_skipped(put_materials):
    """The record is the attached selection: an empty or text-less one still counts, an
    unattached or unsupported one does not."""
    contents = {
        "a.pdf": b"%PDF-a",
        "empty.pdf": b"",
        "off.pdf": b"%PDF-off",
        "notes.zip": b"zip",
    }
    listing = [
        {"name": n, "size": len(b), **({"attach": False} if n == "off.pdf" else {})}
        for n, b in contents.items()
    ]
    with (
        patch.object(runner.db_client, "file_exists", return_value=True),
        patch.object(runner.db_client, "list_materials", return_value=listing),
        patch.object(
            runner.db_client,
            "get_file_bytes",
            side_effect=lambda c, l, k, name: contents.get(name, b"transcript"),
        ),
        patch.object(runner, "summarize", return_value="# s"),
        patch.object(runner.db_client, "put_summary"),
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    assert result == {"status": "done", "usedMaterial": True}
    put_materials.assert_called_once_with("C1", "L1", "lecture", ["a.pdf", "empty.pdf"])


def test_exec_summarize_records_textless_office_file(put_materials):
    contents = {"a.pdf": b"%PDF-a", "blank.docx": b"not a zip"}
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
        patch.object(runner, "summarize", return_value="# s"),
        patch.object(runner.db_client, "put_summary"),
    ):
        runner._exec_summarize("C1", "L1", "lecture")
    put_materials.assert_called_once_with(
        "C1", "L1", "lecture", ["a.pdf", "blank.docx"]
    )


# ---- summarize: materials-only (no video) ----


def _run_exec_summarize_no_transcript(
    *, video: bool, contents: dict[str, bytes]
) -> tuple[dict, Mock, Mock, Mock]:
    """Run _exec_summarize with no transcript.txt, `video` deciding video.mp4, and a material
    listing ({name: bytes}); returns the result and the summarize/summarize_materials/put mocks."""

    seen: dict = {}

    def _fake_materials(paths):
        seen["names"] = [p.name for p in paths]
        seen["bytes"] = [p.read_bytes() for p in paths]
        return "# from slides"

    with (
        patch.object(
            runner.db_client,
            "file_exists",
            side_effect=lambda c, l, k, name: video and name == "video.mp4",
        ),
        patch.object(
            runner.db_client,
            "list_materials",
            return_value=[{"name": n, "size": len(b)} for n, b in contents.items()],
        ),
        patch.object(
            runner.db_client,
            "get_file_bytes",
            side_effect=lambda c, l, k, name: contents[name],
        ),
        patch.object(runner, "summarize") as transcript_summarize,
        patch.object(
            runner, "summarize_materials", side_effect=_fake_materials
        ) as materials_summarize,
        patch.object(runner.db_client, "put_summary") as put_summary,
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    materials_summarize.seen = seen
    return result, transcript_summarize, materials_summarize, put_summary


def test_exec_summarize_materials_only_summarizes_the_pdfs():
    result, transcript_summarize, materials_summarize, put_summary = (
        _run_exec_summarize_no_transcript(
            video=False, contents={"material.pdf": b"%PDF-a", "material.2.pdf": b""}
        )
    )
    assert result == {"status": "done", "usedMaterial": True}
    assert materials_summarize.seen == {"names": ["material.pdf"], "bytes": [b"%PDF-a"]}
    transcript_summarize.assert_not_called()
    put_summary.assert_called_once_with(
        "C1", "L1", "lecture", "# from slides", fresh=True
    )


def test_exec_summarize_with_a_video_still_needs_the_transcript():
    result, _, materials_summarize, put_summary = _run_exec_summarize_no_transcript(
        video=True, contents={"material.pdf": b"%PDF-a"}
    )
    assert result["code"] == "missing_prerequisite"
    assert result["params"] == {"file": "transcript.txt", "step": "transcribe"}
    materials_summarize.assert_not_called()
    put_summary.assert_not_called()


def test_exec_summarize_with_no_video_and_no_materials_needs_the_transcript():
    result, _, materials_summarize, _ = _run_exec_summarize_no_transcript(
        video=False, contents={}
    )
    assert result["code"] == "missing_prerequisite"
    materials_summarize.assert_not_called()


def test_exec_summarize_materials_all_empty_is_materials_empty():
    result, _, materials_summarize, put_summary = _run_exec_summarize_no_transcript(
        video=False, contents={"material.pdf": b"", "material.2.pdf": b""}
    )
    assert result["status"] == "error"
    assert (result["code"], result["params"]) == ("materials_empty", {})
    materials_summarize.assert_not_called()
    put_summary.assert_not_called()


def test_exec_summarize_with_audio_but_no_transcript_never_lists_materials():
    with (
        patch.object(
            runner.db_client,
            "file_exists",
            side_effect=lambda c, l, k, name: name == "audio.mp3",
        ),
        patch.object(runner.db_client, "list_materials") as list_materials,
        patch.object(runner.db_client, "put_summary") as put_summary,
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    assert result["code"] == "missing_prerequisite"
    assert result["params"] == {"file": "transcript.txt", "step": "transcribe"}
    list_materials.assert_not_called()
    put_summary.assert_not_called()


def test_a_video_arriving_mid_materials_summarize_discards_the_summary():
    """The upload wiped derived files mid-call; writing now would leave a PDF-only summary.md
    that next_step treats as the video's, so the transcript would never be summarized."""
    video_checks = iter(
        [False, True]
    )  # absent at the start, present after Gemini returns

    def _exists(course, lecture, kind, name):
        return name == "video.mp4" and next(video_checks)

    with (
        patch.object(runner.db_client, "file_exists", side_effect=_exists),
        patch.object(
            runner.db_client, "list_materials", return_value=[{"name": "m.pdf"}]
        ),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"%PDF"),
        patch.object(runner, "summarize_materials", return_value="# stale"),
        patch.object(runner.db_client, "put_summary") as put_summary,
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    assert result["status"] == "error"
    assert result["code"] == "missing_prerequisite"
    assert result["params"] == {"file": "transcript.txt", "step": "transcribe"}
    put_summary.assert_not_called()


def test_exec_summarize_materials_only_rejects_an_empty_summary():
    with (
        patch.object(runner.db_client, "file_exists", return_value=False),
        patch.object(
            runner.db_client, "list_materials", return_value=[{"name": "m.pdf"}]
        ),
        patch.object(runner.db_client, "get_file_bytes", return_value=b"%PDF"),
        patch.object(runner, "summarize_materials", return_value=""),
        patch.object(runner.db_client, "put_summary") as put_summary,
    ):
        result = runner._exec_summarize("C1", "L1", "lecture")
    assert (result["code"], result["params"]) == ("empty_file", {"file": "summary.md"})
    put_summary.assert_not_called()


def test_a_materials_only_pipeline_runs_summarize_pdf_drive():
    """No video plus materials: /pipeline skips audio and transcribe and ends at drive."""
    states = [
        _files(),
        _files(summary=True),
        _files(summary=True, pdf=True),
        _files(summary=True, pdf=True, drive=True),
    ]
    steps: list[str] = []

    async def fake_fetch(course, lecture, kind):
        return states[len(steps)]

    async def fake_call(course, lecture, kind, step, **_opts):
        steps.append(step)
        return {"status": "done"}

    with (
        patch.object(runner, "_fetch_files", fake_fetch),
        patch.object(runner, "_call_step", fake_call),
        patch.object(
            runner.db_client, "list_materials", return_value=[{"name": "m.pdf"}]
        ),
        patch.object(runner.db_client, "notify"),
    ):
        asyncio.run(runner.run_pipeline_for("C1", "L1", "lecture"))
    assert steps == ["summarize", "pdf", "drive"]


def test_a_pipeline_with_a_video_never_lists_materials():
    with (
        patch.object(runner, "_fetch_files", AsyncMock(return_value=_STATES[-1])),
        patch.object(runner.db_client, "list_materials") as list_materials,
        patch.object(runner.db_client, "notify"),
    ):
        asyncio.run(runner.run_pipeline_for("C1", "L1", "lecture"))
    list_materials.assert_not_called()


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


def test_exec_transcribe_rate_limit_is_a_flagged_error_keeping_the_partial():
    """A Groq 429 is a coded error flagged groq_limit; the partial still round-trips."""
    puts: list[str] = []
    err = runner.TranscribeRateLimitError(
        {"message": "slow down", "limit": 7200, "retry_after_seconds": 750.0}
    )

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

    assert result["status"] == "error"
    assert result["groq_limit"] is True
    assert result["code"] == "groq_rate_limited"
    assert result["params"] == {
        "limit": 7200,
        "used": None,
        "requested": None,
        "retry_after_seconds": 750.0,
    }
    assert runner.PARTIAL_TXT in puts and runner.PARTIAL_META in puts


# ---- error is logged, not just stored ----


def test_run_step_logs_error(caplog):
    """An error outcome is logged (not only stored in _errors), so the terminal shows
    the failure instead of a silent jump to the next lecture."""

    async def fake_call(course, lecture, kind, step, **_opts):
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
    assert stored == {
        "step": "transcribe",
        "message": "boom",
        # An executor that named no code folds into the developer-facing catch-all.
        "code": "unknown_error",
        "params": {},
        "provider": None,
        "blocked": False,
    }
    assert any("step transcribe failed" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize(
    "code, level",
    [
        ("gemini_overloaded", "WARNING"),
        ("groq_rate_limited", "WARNING"),
        ("material_too_large", "WARNING"),
        ("drive_upload_failed", "ERROR"),
        ("summarization_failed", "ERROR"),
    ],
)
def test_run_step_keeps_provider_conditions_below_error(caplog, code, level):
    """ERROR logs become Sentry events; a provider's availability logs WARNING instead."""

    async def fake_call(course, lecture, kind, step, **_opts):
        return {"status": "error", "message": "boom", "code": code}

    async def go():
        with (
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            await runner._run_step_unlocked("C1", "L1", "lecture", "summarize")

    with caplog.at_level("WARNING", logger="runner"):
        asyncio.run(go())
    runner._errors.pop(runner._skey("C1", "L1", "lecture"), None)

    [record] = [r for r in caplog.records if "step summarize failed" in r.getMessage()]
    assert record.levelname == level


# ---- lecture deleted mid-run ----


def test_a_lecture_deleted_mid_step_stops_its_run_with_lecture_not_found():
    """The step's output write is refused because the lecture dir is gone: the run stops
    there with that code rather than re-listing the vanished lecture and running `audio`."""

    fetches: list[int] = []

    async def fake_fetch(course, lecture, kind):
        fetches.append(1)
        return _files(video=True, audio=True, transcript=True, summary=True)

    def fake_render(md_path):
        pdf = Path(md_path).with_suffix(".pdf")
        pdf.write_bytes(b"%PDF")
        return str(pdf), None

    gone = runner.db_client.DbClientError(
        "lecture not found",
        "lecture_not_found",
        course="C1",
        lecture="L1",
    )
    with (
        patch.object(runner, "_fetch_files", fake_fetch),
        patch.object(runner.db_client, "file_exists", return_value=True),
        patch.object(runner.db_client, "get_summary", return_value="# s"),
        patch.object(runner, "convert_to_pdf", side_effect=fake_render),
        patch.object(runner.db_client, "put_file_bytes", side_effect=gone),
        patch.object(runner.db_client, "delete_file") as delete_file,
        patch.object(runner, "strip_audio") as strip_audio,
        patch.object(runner.db_client, "notify"),
    ):
        asyncio.run(runner.run_pipeline_for("C1", "L1", "lecture"))

    stored = runner._errors.pop(runner._skey("C1", "L1", "lecture"))
    assert (stored["step"], stored["code"], stored["params"]) == (
        "pdf",
        "lecture_not_found",
        {"course": "C1", "lecture": "L1"},
    )
    assert fetches == [1]
    strip_audio.assert_not_called()
    delete_file.assert_not_called()


# ---- in-flight across a pipeline's steps ----

_SKEY = runner._skey("C1", "L1", "lecture")
_STATES = [
    _files(video=True),
    _files(video=True, audio=True),
    _files(video=True, audio=True, transcript=True),
    _files(video=True, audio=True, transcript=True, summary=True, pdf=True, drive=True),
]


def _run_pipeline_observed(results, *, honor_block=False):
    """Run a pipeline over _STATES; return the in-flight step each fetch saw, and notifies."""

    seen: list[str | None] = []

    async def fake_fetch(course, lecture, kind):
        entry = runner._in_flight.get(_SKEY)
        seen.append(entry and entry["step"])
        return _STATES[len(seen) - 1]

    async def fake_call(course, lecture, kind, step, **_opts):
        result = results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    with (
        patch.object(runner, "_fetch_files", fake_fetch),
        patch.object(runner, "_call_step", fake_call),
        patch.object(runner.db_client, "notify") as notify,
    ):
        try:
            asyncio.run(
                runner.run_pipeline_for("C1", "L1", "lecture", honor_block=honor_block)
            )
        except RuntimeError:
            pass
        # The last call clears the entry: nothing notifies with it still present after.
        assert _SKEY not in runner._in_flight
    return seen, notify.call_count


def test_a_pipeline_stays_in_flight_between_steps_and_clears_on_success():
    """The step-end gap where /status read empty is gone: the entry spans every step."""
    done = {"status": "done"}
    seen, _ = _run_pipeline_observed([done, done, done])
    # First fetch precedes any step; every later one sees the previous step still in flight.
    assert seen == [None, "audio", "transcribe", "summarize"]


def test_a_failed_step_clears_in_flight_and_keeps_its_error():
    try:
        seen, _ = _run_pipeline_observed(
            [{"status": "done"}, {"status": "error", "message": "boom"}]
        )
        assert seen == [None, "audio"]
        assert runner._errors[_SKEY]["message"] == "boom"
    finally:
        runner._errors.pop(_SKEY, None)


def test_an_exception_mid_step_still_clears_in_flight():
    seen, _ = _run_pipeline_observed([{"status": "done"}, RuntimeError("db down")])
    assert seen == [None, "audio"]


def test_an_early_stop_on_the_quota_block_clears_in_flight():
    runner._summarize_block = {"message": "q", "params": {}}
    try:
        seen, _ = _run_pipeline_observed(
            [{"status": "done"}, {"status": "done"}], honor_block=True
        )
        assert seen == [None, "audio", "transcribe"]
        assert runner._errors[_SKEY]["code"] == "gemini_quota_blocked"
    finally:
        runner._summarize_block = None
        runner._errors.pop(_SKEY, None)


def test_a_pipeline_with_nothing_to_do_does_not_notify():
    """run_all's per-lecture end stays silent when no step ran (no notify burst)."""
    with (
        patch.object(runner, "_fetch_files", AsyncMock(return_value=_STATES[-1])),
        patch.object(runner.db_client, "notify") as notify,
    ):
        asyncio.run(runner.run_pipeline_for("C1", "L1", "lecture"))
    notify.assert_not_called()


def test_a_lone_step_clears_in_flight_when_it_ends():
    async def fake_call(course, lecture, kind, step, **_opts):
        assert runner._in_flight[_SKEY]["step"] == "audio"
        return {"status": "done"}

    with (
        patch.object(runner, "_call_step", fake_call),
        patch.object(runner.db_client, "notify") as notify,
    ):
        asyncio.run(runner.run_step("C1", "L1", "lecture", "audio"))
    assert _SKEY not in runner._in_flight
    assert notify.call_count == 2  # start, then the clear


# ---- run_all hands in_flight from one lecture to the next ----


def _run_all_observed(plans: dict, *, fetch_error: str | None = None):
    """Run run_all over `plans` (lecture → step results; [] = nothing to do); return the
    lectures in_flight held at each notify."""

    snapshots: list[list[str]] = []
    totals = {lecture: len(results) for lecture, results in plans.items()}

    async def fake_fetch(course, lecture, kind):
        if lecture == fetch_error:
            raise RuntimeError("db down")
        if not plans[lecture]:
            return _STATES[
                -1
            ]  # every planned step ran, or a step error cleared the plan
        return _STATES[totals[lecture] - len(plans[lecture])]

    async def fake_call(course, lecture, kind, step, **_opts):
        result = plans[lecture].pop(0)
        if result["status"] == "error":
            plans[lecture].clear()
        return result

    def record():
        snapshots.append(sorted(e["lecture"] for e in runner._in_flight.values()))

    async def go():
        runner._queue[:] = [_entry(lecture) for lecture in plans]
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify", record),
        ):
            await runner.run_all()

    asyncio.run(go())
    assert runner._in_flight == {} and runner._handover is None
    return snapshots


class TestRunAllHandover:
    """Between two lectures /status shows the finished one until the next one's first step
    start replaces it in one notify, so in_flight never reads empty mid-run."""

    @pytest.fixture(autouse=True)
    def _clean(self, clean_queue):
        yield
        runner._errors.clear()
        runner._handover = None

    def test_in_flight_is_never_empty_between_lectures(self):
        done = {"status": "done"}
        snaps = _run_all_observed(
            {"L1": [done, done], "L2": [done], "L3": [done, done]}
        )
        # Every notify but the run's last carries a lecture; each handover swaps in one update.
        assert snaps == [["L1"], ["L1"], ["L2"], ["L3"], ["L3"], []]

    def test_a_no_op_entry_clears_the_held_lecture_once(self):
        done = {"status": "done"}
        snaps = _run_all_observed({"L1": [done], "L2": [], "L3": [], "L4": [done]})
        assert snaps == [["L1"], [], ["L4"], []]

    def test_a_step_error_clears_the_lecture_and_notifies(self):
        done, err = {"status": "done"}, {"status": "error", "message": "boom"}
        snaps = _run_all_observed({"L1": [done], "L2": [err], "L3": [done]})
        assert snaps == [["L1"], ["L2"], [], ["L3"], []]
        assert runner._errors[runner._skey("C1", "L2", "lecture")]["message"] == "boom"

    def test_an_exception_clears_the_held_lecture(self):
        done = {"status": "done"}
        snaps = _run_all_observed({"L1": [done], "L2": [done]}, fetch_error="L2")
        assert snaps == [["L1"], [], []]
        assert runner._runner_status["last_error"]["code"] == "run_crashed"
        runner._runner_status["last_error"] = None

    def test_the_last_lecture_is_cleared_at_run_end(self):
        snaps = _run_all_observed({"L1": [{"status": "done"}]})
        assert snaps == [["L1"], []]


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


def test_exec_summarize_per_minute_quota_is_an_unflagged_error():
    """A per-minute quota stops its lecture like any error but blocks no run."""
    result = _run_exec_summarize({"is_daily": False})
    assert result["status"] == "error"
    assert result["daily_quota"] is False
    assert result["code"] == "gemini_quota_exhausted"
    assert result["params"]["scope"] == "per_minute"


def test_exec_summarize_daily_quota_is_error_not_retried():
    """A daily quota is a plain flagged error — its retryDelay lies, so no retry."""
    result = _run_exec_summarize({"is_daily": True})
    assert result["status"] == "error"
    assert result["daily_quota"] is True
    assert result["message"] == "quota message"
    assert result["code"] == "gemini_quota_exhausted"
    assert result["params"] == {
        "scope": "daily",
        "model": None,
        "limit": None,
        "tier": None,
    }


def test_a_crashed_run_records_a_coded_last_error():
    """A crash is the one failure with no lecture record to hang on, so it rides `last_error`
    — carrying the same {message, code, params} shape as every other channel."""

    async def boom(entry):
        raise RuntimeError("database service is down")

    async def go():
        with (
            patch.object(runner, "_run_entry", boom),
            patch.object(runner.db_client, "notify"),
        ):
            runner._queue[:] = [runner.QueueEntry("C1", "L1", "lecture", "full")]
            await runner.run_all()

    try:
        asyncio.run(go())
        assert runner._runner_status["last_error"] == {
            "message": "C1/L1: database service is down",
            "code": "run_crashed",
            "params": {
                "course": "C1",
                "lecture": "L1",
                "detail": "database service is down",
            },
        }
    finally:
        runner._runner_status["last_error"] = None
        runner._queue.clear()


# ---- Groq rate-limit block ----


GROQ_PARAMS = {
    "limit": 7200,
    "used": 7019,
    "requested": 600,
    "retry_after_seconds": 209.5,
}


def _groq_error_result():
    return {
        "status": "error",
        "message": "rate limit",
        "groq_limit": True,
        "code": "groq_rate_limited",
        "params": GROQ_PARAMS,
    }


def test_groq_limit_blocks_transcribe_for_later_lectures():
    """The first lecture hits Groq; the rest stop before transcribing, marked blocked."""
    steps_run: list[tuple[str, str]] = []

    async def fake_fetch(course, lecture, kind):
        return _files(video=True, audio=True)

    async def fake_call(course, lecture, kind, step, **_opts):
        steps_run.append((lecture, step))
        return _groq_error_result()

    async def go():
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            runner._queue[:] = [
                runner.QueueEntry("C1", lecture, "lecture", "full")
                for lecture in ("L1", "L2")
            ]
            await runner.run_all()

    try:
        asyncio.run(go())
        assert steps_run == [("L1", "transcribe")]
        first = runner._errors[runner._skey("C1", "L1", "lecture")]
        second = runner._errors[runner._skey("C1", "L2", "lecture")]
        assert (first["code"], first["blocked"], first["provider"]) == (
            "groq_rate_limited",
            False,
            "groq",
        )
        assert (second["code"], second["blocked"], second["provider"]) == (
            "groq_rate_limit_blocked",
            True,
            "groq",
        )
        assert second["params"] == GROQ_PARAMS and second["step"] == "transcribe"
        assert runner._transcribe_block is None  # cleared by run_all's finally
        assert not runner._locks[runner._lkey("C1", "L1", "lecture")].locked()
    finally:
        runner._errors.clear()
        runner._queue.clear()
        runner._transcribe_block = None


def test_groq_blocked_error_carries_stated_retry_after():
    """The delay Groq stated reaches the blocked lecture's error params unchanged."""
    params = {**GROQ_PARAMS, "retry_after_seconds": 61.25}

    async def fake_fetch(course, lecture, kind):
        return _files(video=True, audio=True)

    async def fake_call(course, lecture, kind, step, **_opts):
        return {**_groq_error_result(), "params": params}

    async def go():
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            runner._queue[:] = [
                runner.QueueEntry("C1", lecture, "lecture", "full")
                for lecture in ("L1", "L2")
            ]
            await runner.run_all()

    try:
        asyncio.run(go())
        blocked = runner._errors[runner._skey("C1", "L2", "lecture")]
        assert blocked["code"] == "groq_rate_limit_blocked"
        assert blocked["params"]["retry_after_seconds"] == 61.25
    finally:
        runner._errors.clear()
        runner._queue.clear()
        runner._transcribe_block = None


def test_transcribe_start_clears_groq_records_and_lifts_block():
    """Any transcribe attempt drops every Groq record and the run's stop; others stay."""
    runner._errors.update(
        {
            "hit": runner._error_record(
                "transcribe", "r", code="groq_rate_limited", params=GROQ_PARAMS
            ),
            "stopped": runner._error_record(
                "transcribe",
                "r",
                code="groq_rate_limit_blocked",
                params=GROQ_PARAMS,
                blocked=True,
            ),
            "other": runner._error_record("pdf", "boom", code="pdf_pandoc_failed"),
        }
    )
    runner._transcribe_block = {"message": "r", "params": GROQ_PARAMS}

    async def fake_call(course, lecture, kind, step, **_opts):
        return {"status": "done"}

    async def go():
        with (
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            await runner.run_step("C1", "L9", "lecture", "transcribe")

    try:
        asyncio.run(go())
        assert list(runner._errors) == ["other"]
        assert runner._transcribe_block is None
    finally:
        runner._errors.clear()
        runner._transcribe_block = None


# ---- Gemini daily-quota block ----


QUOTA_PARAMS = {
    "scope": "daily",
    "model": "gemini-2.5-flash",
    "limit": 20,
    "tier": "free",
}


def _quota_error_result(
    message="Gemini free-tier daily quota reached (20 requests/day) — resets at midnight Pacific",
):
    return {
        "status": "error",
        "message": message,
        "daily_quota": True,
        "code": "gemini_quota_exhausted",
        "params": QUOTA_PARAMS,
    }


def test_daily_quota_error_record():
    """A daily-quota failure is tagged quota/gemini so the UI can say so."""

    async def fake_call(course, lecture, kind, step, **_opts):
        return _quota_error_result("quota msg")

    async def go():
        with (
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            await runner._run_step_unlocked("C1", "L1", "lecture", "summarize")

    try:
        asyncio.run(go())
        assert runner.get_status()["errors"] == {
            runner._skey("C1", "L1", "lecture"): {
                "step": "summarize",
                "message": "quota msg",
                "code": "gemini_quota_exhausted",
                "params": QUOTA_PARAMS,
                "provider": "gemini",
                "blocked": False,
            }
        }
        assert runner._summarize_block == {
            "message": "quota msg",
            "params": QUOTA_PARAMS,
        }
    finally:
        runner._errors.clear()
        runner._summarize_block = None


def test_daily_quota_blocks_summarize_for_later_lectures(caplog):
    """First lecture calls Gemini and hits the quota; every later lecture stops at
    transcript.txt without calling it, carrying the same quota record, and still
    counts as blocked rather than halted."""
    steps_run: list[tuple[str, str]] = []
    queue = [
        runner.QueueEntry("C1", lecture, "lecture", "full")
        for lecture in ("L1", "L2", "L3")
    ]

    async def fake_fetch(course, lecture, kind):
        # Everything is transcribed already, so next_step is always summarize
        # until summary.md exists (it never does here).
        return _files(video=True, audio=True, transcript=True)

    async def fake_call(course, lecture, kind, step, **_opts):
        steps_run.append((lecture, step))
        return _quota_error_result()

    async def go():
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
            caplog.at_level("INFO", logger="runner"),
        ):
            runner._queue[:] = queue
            return await runner.run_all()

    try:
        asyncio.run(go())
        assert steps_run == [("L1", "summarize")], (
            "only the first lecture may call Gemini"
        )
        record = {
            "step": "summarize",
            "message": _quota_error_result()["message"],
            "params": QUOTA_PARAMS,
            "provider": "gemini",
        }
        assert runner._errors == {
            runner._skey("C1", lecture, "lecture"): {
                **record,
                # L1 hit the quota; the rest were stopped on it, and say so in the code.
                "code": "gemini_quota_exhausted"
                if lecture == "L1"
                else "gemini_quota_blocked",
                "blocked": lecture != "L1",
            }
            for lecture in ("L1", "L2", "L3")
        }
        assert any(
            "2 stopped on a Gemini daily quota or Groq rate limit" in r.getMessage()
            for r in caplog.records
        )
    finally:
        runner._errors.clear()
        runner._queue.clear()
        runner._summarize_block = None


def test_daily_quota_block_is_cleared_and_bypassed_by_manual_runs():
    """run_all clears the flag in its finally; a manual /pipeline trigger never
    consults it (the user may have swapped keys since)."""
    calls: list[str] = []

    async def fake_fetch(course, lecture, kind):
        return _files(video=True, audio=True, transcript=True)

    async def fake_call(course, lecture, kind, step, **_opts):
        calls.append(step)
        return _quota_error_result()

    async def go():
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            runner._queue[:] = [runner.QueueEntry("C1", "L1", "lecture", "full")]
            await runner.run_all()
            assert runner._summarize_block is None  # cleared by run_all's finally
            # As if a run were still blocked.
            runner._summarize_block = {"message": "quota", "params": QUOTA_PARAMS}
            await runner.run_pipeline_for("C1", "L2", "lecture")

    try:
        asyncio.run(go())
        assert calls == ["summarize", "summarize"]
    finally:
        runner._errors.clear()
        runner._queue.clear()
        runner._summarize_block = None


def test_summarize_start_clears_quota_records_and_lifts_block():
    """Any summarize attempt drops every lecture's quota record and the run's stop;
    other errors stay."""
    runner._errors.update(
        {
            "hit": runner._error_record(
                "summarize", "q", code="gemini_quota_exhausted", params=QUOTA_PARAMS
            ),
            "stopped": runner._error_record(
                "summarize",
                "q",
                code="gemini_quota_blocked",
                params=QUOTA_PARAMS,
                blocked=True,
            ),
            "other": runner._error_record("pdf", "boom", code="pdf_pandoc_failed"),
        }
    )
    runner._summarize_block = {"message": "q", "params": QUOTA_PARAMS}

    async def fake_call(course, lecture, kind, step, **_opts):
        return {"status": "done"}

    async def go():
        with (
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            await runner.run_step("C1", "L9", "lecture", "summarize")

    try:
        asyncio.run(go())
        # The sweep tests membership of BOTH quota codes: missing one strands every lecture
        # the run stopped, whose record no later attempt would ever clear.
        assert list(runner._errors) == ["other"]
        assert runner._summarize_block is None
    finally:
        runner._errors.clear()
        runner._summarize_block = None


def test_manual_summarize_mid_run_lets_queued_lectures_summarize():
    """L1 hits the quota; a manual summarize elsewhere lifts the stop before L2 is
    taken, so L2 and L3 call Gemini instead of being stopped."""
    summarized: set[str] = set()
    calls: list[str] = []
    manual_done = False

    async def fake_fetch(course, lecture, kind):
        nonlocal manual_done
        if lecture == "L2" and not manual_done:
            manual_done = True
            await runner.run_step("C1", "M", "lecture", "summarize")
        done = lecture in summarized
        return _files(
            video=True,
            audio=True,
            transcript=True,
            summary=done,
            pdf=done,
            drive=done,
        )

    async def fake_call(course, lecture, kind, step, **_opts):
        calls.append(lecture)
        if lecture == "L1":
            return _quota_error_result()
        summarized.add(lecture)
        return {"status": "done"}

    async def go():
        with (
            patch.object(runner, "_fetch_files", fake_fetch),
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            runner._queue[:] = [
                runner.QueueEntry("C1", lecture, "lecture", "full")
                for lecture in ("L1", "L2", "L3")
            ]
            await runner.run_all()

    try:
        asyncio.run(go())
        assert calls == ["L1", "M", "L2", "L3"]
        assert runner._errors == {}  # L1's hit record was cleared by M's attempt
    finally:
        runner._errors.clear()
        runner._queue.clear()
        runner._summarize_block = None


@pytest.fixture
def clean_queue():
    """The queue, the locks and the run flag are module state; every test here mutates them."""

    yield
    runner._queue.clear()
    runner._locks.clear()
    runner._in_flight.clear()
    runner._runner_status["running"] = False


def _entry(lecture: str, depth: str = "full") -> runner.QueueEntry:
    return runner.QueueEntry("C1", lecture, "lecture", depth)


class TestEnqueue:
    """enqueue is the single point of entry: it de-duplicates against everything the runner
    already has in hand, so a repeat trigger can never double-run a lecture."""

    def test_appends_once_and_refuses_a_duplicate(self, clean_queue):
        async def go():
            # Already running, so nothing starts a drain that would empty the queue under us.
            runner._runner_status["running"] = True
            assert runner.enqueue(_entry("L1")) is True
            assert runner.enqueue(_entry("L1")) is False
            assert runner.enqueue(_entry("L2")) is True

        asyncio.run(go())
        assert runner._queue == [_entry("L1"), _entry("L2")]

    def test_an_idle_enqueue_resets_the_previous_runs_counters(self, clean_queue):
        runner._runner_status.update(done=19, total=19, last_error={"code": "x"})

        async def go():
            with patch.object(runner, "run_all", new=AsyncMock()):
                runner.enqueue(_entry("L1"))
                runner.enqueue(_entry("L2"))
                return dict(runner._runner_status)

        status = asyncio.run(go())
        assert (status["running"], status["done"], status["total"]) == (True, 0, 2)
        assert status["last_error"] is None

    def test_a_queued_lecture_is_matched_whatever_its_depth(self, clean_queue):
        async def go():
            runner._runner_status["running"] = True
            assert runner.enqueue(_entry("L1", "audio")) is True
            # Same lecture at a deeper setting: still one entry, still the one that got there first.
            assert runner.enqueue(_entry("L1", "full")) is False

        asyncio.run(go())
        assert runner._queue == [_entry("L1", "audio")]

    def test_refuses_a_lecture_in_flight(self, clean_queue):
        async def go():
            runner._runner_status["running"] = True
            runner._in_flight[runner._skey("C1", "L1", "lecture")] = {"step": "audio"}
            assert runner.enqueue(_entry("L1")) is False

        asyncio.run(go())
        assert runner._queue == []

    def test_refuses_a_lecture_a_concurrent_trigger_owns(self, clean_queue):
        async def go():
            runner._runner_status["running"] = True
            held = runner._locks.setdefault(
                runner._lkey("C1", "L1", "lecture"), asyncio.Lock()
            )
            async with held:
                assert runner.enqueue(_entry("L1")) is False
            assert runner.enqueue(_entry("L1")) is True  # released → it queues

        asyncio.run(go())

    def test_starts_the_drain_once_for_a_burst(self, clean_queue):
        """A batch of arrivals in one callback must produce one run_all, not one each."""

        runs: list = []

        async def go():
            with patch.object(runner, "run_all", side_effect=lambda: runs.append(1)):
                for name in ("L1", "L2", "L3"):
                    runner.enqueue(_entry(name))
                await asyncio.sleep(0)  # let any created task start

        asyncio.run(go())
        assert len(runs) == 1
        assert runner._runner_status["running"] is True


@pytest.mark.parametrize(
    "start",
    [
        lambda: runner.try_run_step("C1", "L2", "lecture", "audio"),
        lambda: runner.try_run_pipeline("C1", "L2", "lecture"),
    ],
    ids=["step", "pipeline"],
)
def test_a_manual_run_pulls_its_lecture_out_of_the_queue(clean_queue, start):
    """A queued lecture the user runs by hand runs now; the queue must not list or re-run it."""

    async def go():
        runner._queue[:] = [_entry("L1"), _entry("L2"), _entry("L3")]
        with (
            patch.object(runner, "run_step", AsyncMock()),
            patch.object(runner, "run_pipeline_for", AsyncMock()),
        ):
            assert start() == "started"
            await asyncio.sleep(0)

    asyncio.run(go())
    assert runner._queue == [_entry("L1"), _entry("L3")]


class TestMoveToFront:
    """Reordering only: the entry keeps its depth, the queue its length, and only a real move
    pushes a notify."""

    def test_moves_a_queued_lecture_to_index_zero(self, clean_queue):
        runner._queue[:] = [_entry("L1"), _entry("L2"), _entry("L3", "audio")]
        with patch.object(runner.db_client, "notify") as notify:
            assert runner.move_to_front("C1", "L3", "lecture") == "moved"
        assert runner._queue == [_entry("L3", "audio"), _entry("L1"), _entry("L2")]
        notify.assert_called_once()

    def test_the_first_entry_is_a_silent_no_op(self, clean_queue):
        runner._queue[:] = [_entry("L1"), _entry("L2")]
        with patch.object(runner.db_client, "notify") as notify:
            assert runner.move_to_front("C1", "L1", "lecture") == "moved"
        assert runner._queue == [_entry("L1"), _entry("L2")]
        notify.assert_not_called()

    def test_a_lecture_not_in_the_queue_is_not_queued(self, clean_queue):
        runner._queue[:] = [_entry("L1")]
        runner._in_flight[runner._skey("C1", "L2", "lecture")] = {"step": "audio"}
        with patch.object(runner.db_client, "notify") as notify:
            assert runner.move_to_front("C1", "L2", "lecture") == "not_queued"
            # Same lecture name, other kind: a different queue entry.
            assert runner.move_to_front("C1", "L1", "recitation") == "not_queued"
        assert runner._queue == [_entry("L1")]
        notify.assert_not_called()


class TestQueueDrain:
    """run_all owns the queue rather than a caller's list, so the run absorbs whatever
    arrives while it is going."""

    def test_a_lecture_enqueued_mid_run_joins_the_same_run(self, clean_queue):
        ran: list[str] = []

        totals: list[int] = []

        async def fake_entry(entry):
            ran.append(entry.lecture)
            if entry.lecture == "L1":
                runner.enqueue(_entry("L3"))
                # Counted on arrival, not only once the running lecture finishes.
                totals.append(runner._runner_status["total"])
            return False

        async def go():
            runner._queue[:] = [_entry("L1"), _entry("L2")]
            with (
                patch.object(runner, "_run_entry", fake_entry),
                patch.object(runner.db_client, "notify"),
            ):
                await runner.run_all()

        asyncio.run(go())
        assert ran == ["L1", "L2", "L3"]
        assert totals == [3]
        assert runner._runner_status["total"] == 3
        assert runner._runner_status["done"] == 3

    def test_audio_depth_stops_at_audio_mp3(self, clean_queue):
        steps: list[str] = []

        async def go():
            with (
                patch.object(runner.db_client, "file_exists", _disk("video.mp4")),
                patch.object(
                    runner,
                    "run_step",
                    side_effect=lambda c, l, k, step: steps.append(step),
                ),
                patch.object(runner.db_client, "notify"),
            ):
                await runner._run_entry(_entry("L1", "audio"))

        asyncio.run(go())
        assert steps == ["audio"]

    def test_audio_depth_does_nothing_once_audio_exists(self, clean_queue):
        steps: list[str] = []

        async def go():
            with (
                patch.object(runner.db_client, "file_exists", return_value=True),
                patch.object(
                    runner,
                    "run_step",
                    side_effect=lambda c, l, k, step: steps.append(step),
                ),
            ):
                await runner._run_entry(_entry("L1", "audio"))

        asyncio.run(go())
        assert steps == []


class TestAutoRun:
    """AUTO_RUN is a ceiling on automatic work: it caps a video's arrival,
    and never a run the user asked for."""

    @pytest.fixture(autouse=True)
    def _no_drain(self, clean_queue):
        # Stub the drain so the queue stays inspectable; what is queued is the subject here.
        with patch.object(runner, "run_all"):
            yield

    @pytest.mark.parametrize(
        "mode,expected_status,expected_depth",
        [
            ("full", "queued", "full"),
            ("audio", "queued", "audio"),
            ("", "queued", "full"),  # unset → today's behaviour
            ("nonsense", "queued", "full"),  # unrecognised → the same
        ],
    )
    def test_arrival_queues_at_the_settings_depth(
        self, monkeypatch, mode, expected_status, expected_depth
    ):
        monkeypatch.setenv("AUTO_RUN", mode)

        async def go():
            # enqueue schedules the drain, so it needs a running loop the way its caller has one.
            with patch.object(runner.db_client, "notify"):
                assert runner.enqueue_arrival("C1", "L1", "lecture") == expected_status
            await asyncio.sleep(0)

        asyncio.run(go())
        assert runner._queue == [_entry("L1", expected_depth)]

    def test_arrival_is_dropped_when_off(self, monkeypatch):
        monkeypatch.setenv("AUTO_RUN", "off")

        async def go():
            assert runner.enqueue_arrival("C1", "L1", "lecture") == "off"

        asyncio.run(go())
        assert runner._queue == []


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
            "latex_error",
            {
                "message": "Undefined control sequence",
                "line": 417,
                "at": None,
                "more_count": 0,
            },
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
        raise runner.PdfRenderError(
            "LaTeX error: boom (line 9)", "latex_error", tex_source="\\x"
        )

    _, db = _run_exec_pdf(convert)
    assert db.deletes == [runner.PDF_WARNING_FILE]


def test_exec_pdf_failure_with_no_tex_keeps_the_existing_warning():
    """Only overwriting .pdf_build.tex invalidates the old warning. A pandoc failure or a
    timeout carries no .tex, so the surviving summary.pdf keeps its badge."""

    def convert(md_path):
        raise runner.PdfRenderError("pandoc timed out after 60s", "pdf_tool_timeout")

    _, db = _run_exec_pdf(convert)
    assert db.deletes == []


def test_exec_pdf_failed_tex_upload_keeps_the_existing_warning():
    """The old .pdf_build.tex is untouched when the store failed, so the pair still agrees."""

    def convert(md_path):
        raise runner.PdfRenderError(
            "LaTeX error: boom (line 9)", "latex_error", tex_source="\\x"
        )

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


# ---- prune_stale_errors ----


def test_prune_stale_errors_drops_renamed_and_deleted_lectures():
    """A rename or delete never reaches the runner; the old name's error must not survive it,
    so a lecture later recreated under that name starts clean."""
    old = runner._skey("C1", "L1", "lecture")
    keep = runner._skey("C1", "L2", "lecture")
    renamed = [
        {
            "name": "C1",
            "lectures": [
                {"name": "L1_renamed", "files": _files(video=True)},
                {"name": "L2", "files": _files(video=True)},
            ],
        }
    ]
    deleted = [
        {"name": "C1", "lectures": [{"name": "L2", "files": _files(video=True)}]}
    ]
    recreated = [
        {
            "name": "C1",
            "lectures": [
                {"name": "L1", "files": _files()},
                {"name": "L2", "files": _files(video=True)},
            ],
        }
    ]
    try:
        for tree in (renamed, deleted):
            runner._errors[keep] = runner._error_record("transcribe", "boom", code="x")
            runner._errors[old] = runner._error_record("transcribe", "boom", code="x")
            with patch.object(runner.db_client, "get_tree", return_value=tree):
                asyncio.run(runner.prune_stale_errors())
            assert list(runner._errors) == [keep]
        # The delete's poll already dropped it, so the recreated name has nothing to inherit.
        with patch.object(runner.db_client, "get_tree", return_value=recreated):
            asyncio.run(runner.prune_stale_errors())
        assert list(runner._errors) == [keep]
    finally:
        runner._errors.clear()


def test_prune_stale_errors_keeps_an_existing_lecture_without_a_video():
    """Summarize runs off transcript.txt alone, so a video-less lecture's failure must survive."""
    skey = runner._skey("C1", "L1", "lecture")
    rkey = runner._skey("C1", "R1", "recitation")
    tree = [
        {
            "name": "C1",
            "lectures": [{"name": "L1", "files": _files(transcript=True)}],
            "recitations": [{"name": "R1", "files": _files()}],
        }
    ]
    try:
        runner._errors[skey] = runner._error_record("summarize", "boom", code="x")
        runner._errors[rkey] = runner._error_record("summarize", "boom", code="x")
        with patch.object(runner.db_client, "get_tree", return_value=tree):
            asyncio.run(runner.prune_stale_errors())
        assert set(runner._errors) == {skey, rkey}
    finally:
        runner._errors.clear()


def test_prune_stale_errors_keeps_an_error_written_during_the_tree_fetch():
    """The tree predates a record the loop writes mid-fetch, so that record must survive."""
    stale = runner._skey("C1", "Old", "lecture")
    fresh = runner._skey("C1", "New", "lecture")

    def get_tree():
        runner._errors[fresh] = runner._error_record("transcribe", "boom", code="x")
        return [{"name": "C1", "lectures": []}]

    try:
        runner._errors[stale] = runner._error_record("transcribe", "boom", code="x")
        with patch.object(runner.db_client, "get_tree", side_effect=get_tree):
            asyncio.run(runner.prune_stale_errors())
        assert list(runner._errors) == [fresh]
    finally:
        runner._errors.clear()


# ---- fresh pdf run: the old summary.pdf goes under the lock, before the render ----


def test_exec_pdf_fresh_deletes_the_old_pdf_before_rendering():
    order: list[str] = []
    render = _fake_render(None)

    def convert(md_path):
        order.append("render")
        return render(md_path)

    db = _PdfDb()
    with ExitStack() as stack:
        db.install(stack, convert)
        stack.enter_context(
            patch.object(
                runner.db_client,
                "delete_file",
                lambda c, l, k, name: order.append(f"delete {name}"),
            )
        )
        result = runner._exec_pdf("C1", "L1", "lecture", fresh=True)
    assert result == {"status": "done"}
    assert order[:2] == ["delete summary.pdf", "render"]


def test_exec_pdf_without_fresh_never_deletes_the_pdf():
    _, db = _run_exec_pdf(_fake_render(None))
    assert "summary.pdf" not in db.deletes


def test_exec_pdf_fresh_delete_failure_is_the_step_error_and_skips_the_render():
    """A PDF a viewer holds open cannot be overwritten either, so no render is wasted on it."""

    convert = Mock()
    db = _PdfDb()
    with ExitStack() as stack:
        db.install(stack, convert)
        stack.enter_context(
            patch.object(
                runner.db_client,
                "delete_file",
                Mock(
                    side_effect=runner.db_client.DbClientError(
                        "summary.pdf is open in another program",
                        "file_locked",
                        file="summary.pdf",
                    )
                ),
            )
        )
        result = runner._exec_pdf("C1", "L1", "lecture", fresh=True)
    convert.assert_not_called()
    assert result == {
        "status": "error",
        "message": "summary.pdf is open in another program",
        "code": "file_locked",
        "params": {"file": "summary.pdf"},
    }


def test_fresh_run_step_records_the_delete_failure(clean_queue):
    skey = runner._skey("C1", "L1", "lecture")
    with (
        patch.object(runner.db_client, "notify", lambda: None),
        patch.object(runner.db_client, "file_exists", lambda *a: True),
        patch.object(
            runner.db_client,
            "delete_file",
            Mock(
                side_effect=runner.db_client.DbClientError(
                    "locked", "file_locked", file="summary.pdf"
                )
            ),
        ),
        patch.object(runner, "convert_to_pdf") as convert,
    ):
        asyncio.run(runner.run_step("C1", "L1", "lecture", "pdf", fresh=True))
    stored = runner._errors.pop(skey)
    convert.assert_not_called()
    assert (stored["step"], stored["code"], stored["params"]) == (
        "pdf",
        "file_locked",
        {"file": "summary.pdf"},
    )


def test_a_busy_fresh_pdf_run_leaves_the_old_pdf(clean_queue):
    """The lecture's lock is held by another run: the answer is busy and nothing is deleted."""

    async def go():
        lock = runner._locks.setdefault(
            runner._lkey("C1", "L1", "lecture"), asyncio.Lock()
        )
        await lock.acquire()
        with patch.object(runner.db_client, "delete_file") as delete:
            assert (
                runner.try_run_step("C1", "L1", "lecture", "pdf", fresh=True) == "busy"
            )
            await asyncio.sleep(0)
        delete.assert_not_called()

    asyncio.run(go())


# ---- auto-remove ----


def _rule(monkeypatch, mode: str, after: str) -> None:
    monkeypatch.setenv("AUTO_REMOVE", mode)
    monkeypatch.setenv("AUTO_REMOVE_AFTER", after)


def _disk(*present: str):
    """A file_exists fake answering from a fixed set of names."""

    return lambda _c, _l, _k, name: name in present


class TestRemovalTargets:
    def test_off_or_no_point_removes_nothing(self, monkeypatch):
        files = _files(video=True, audio=True, pdf=True, drive=True)
        _rule(monkeypatch, "off", "pdf")
        assert runner.removal_targets(files) == []
        _rule(monkeypatch, "audio", "")
        assert runner.removal_targets(files) == []

    def test_video_after_pdf(self, monkeypatch):
        _rule(monkeypatch, "video", "pdf")
        assert runner.removal_targets(_files(video=True, audio=True, pdf=True)) == [
            "video.mp4"
        ]
        assert runner.removal_targets(_files(video=True, summary=True)) == []

    def test_audio_is_cumulative_and_lists_only_present_files(self, monkeypatch):
        _rule(monkeypatch, "audio", "pdf")
        assert runner.removal_targets(_files(video=True, audio=True, pdf=True)) == [
            "video.mp4",
            "audio.mp3",
        ]
        assert runner.removal_targets(_files(audio=True, pdf=True)) == ["audio.mp3"]

    def test_after_drive_needs_the_share_url(self, monkeypatch):
        _rule(monkeypatch, "video", "drive")
        assert runner.removal_targets(_files(video=True, pdf=True)) == []
        assert runner.removal_targets(_files(video=True, pdf=True, drive=True)) == [
            "video.mp4"
        ]

    def test_after_drive_with_drive_off_removes_nothing(self, monkeypatch):
        _rule(monkeypatch, "video", "drive")
        monkeypatch.setenv("DRIVE_ENABLED", "false")
        assert runner.removal_targets(_files(video=True, pdf=True, drive=True)) == []


class TestRemovedCountsAsPresent:
    """An auto-removed intermediate stands for its step being done, never for a missing input."""

    def _stripped(self, **existing):
        return runner._mark_removed(_files(**existing), ["video.mp4", "audio.mp3"])

    def test_next_step_resumes_at_drive_not_audio(self):
        files = self._stripped(transcript=True, summary=True, pdf=True)
        assert runner.next_step(files) == "drive"

    def test_not_materials_only(self):
        files = self._stripped(transcript=True, summary=True, pdf=True)
        assert runner.is_materials_only(files, [{"name": "m.pdf"}]) is False

    def test_still_pending_until_its_final_output_exists(self):
        assert runner._lecture_pending(self._stripped(pdf=True)) is True
        assert runner._lecture_pending(self._stripped(pdf=True, drive=True)) is False

    def test_scan_pending_reads_the_trees_removed(self):
        tree = [
            {
                "name": "C1",
                "lectures": [
                    {"name": "L1", "files": _files(pdf=True), "removed": ["video.mp4"]},
                    {"name": "L2", "files": _files(pdf=True), "removed": []},
                ],
                "recitations": [],
            }
        ]
        with patch.object(runner.db_client, "get_tree", return_value=tree):
            assert asyncio.run(runner.scan_pending()) == [("C1", "L1", "lecture")]

    def test_fetch_files_marks_removed_off_the_tree(self):
        tree = [
            {
                "name": "C1",
                "lectures": [],
                "recitations": [{"name": "R1", "files": {}, "removed": ["audio.mp3"]}],
            }
        ]
        with (
            patch.object(runner.db_client, "file_exists", _disk("transcript.txt")),
            patch.object(runner.db_client, "get_tree", return_value=tree),
        ):
            files = asyncio.run(runner._fetch_files("C1", "R1", "recitation"))
        assert runner._present(files, "audio.mp3")
        assert not runner._present(files, "video.mp4")

    def test_audio_deleted_after_transcribe_resumes_at_summarize(self):
        """Video and transcript on disk, audio gone: the tree calls audio removed, not to redo."""

        tree = [
            {
                "name": "C1",
                "lectures": [{"name": "L1", "files": {}, "removed": ["audio.mp3"]}],
                "recitations": [],
            }
        ]
        with (
            patch.object(
                runner.db_client, "file_exists", _disk("video.mp4", "transcript.txt")
            ),
            patch.object(runner.db_client, "get_tree", return_value=tree),
        ):
            files = asyncio.run(runner._fetch_files("C1", "L1", "lecture"))
        assert runner.next_step(files) == "summarize"

    @pytest.mark.parametrize(
        "on_disk", [("video.mp4",), (), ("video.mp4", "audio.mp3", "transcript.txt")]
    )
    def test_fetch_files_reads_the_tree_only_when_audio_is_gone_but_transcript_kept(
        self, on_disk
    ):
        """Fresh video, materials-only (nothing on disk) and a full set all skip the tree walk."""

        tree = Mock(side_effect=AssertionError("tree read"))
        with (
            patch.object(runner.db_client, "file_exists", _disk(*on_disk)),
            patch.object(runner.db_client, "get_tree", tree),
        ):
            asyncio.run(runner._fetch_files("C1", "L1", "lecture"))


class TestAutoRemoveHook:
    """Every locked operation ends by applying the live rule, and never fails on it."""

    def test_a_pdf_step_removes_the_video(self, monkeypatch, clean_queue):
        _rule(monkeypatch, "video", "pdf")
        remove = Mock()
        with (
            patch.dict(runner._EXECUTORS, {"pdf": lambda *a, **k: {"status": "done"}}),
            patch.object(runner.db_client, "notify"),
            patch.object(
                runner.db_client, "file_exists", _disk("video.mp4", "summary.pdf")
            ),
            patch.object(runner.db_client, "remove_files", remove),
        ):
            asyncio.run(runner.run_step("C1", "L1", "lecture", "pdf"))
        remove.assert_called_once_with("C1", "L1", "lecture", ["video.mp4"])

    def test_nothing_is_removed_before_the_point(self, monkeypatch, clean_queue):
        _rule(monkeypatch, "audio", "drive")
        remove = Mock()
        with (
            patch.dict(runner._EXECUTORS, {"pdf": lambda *a, **k: {"status": "done"}}),
            patch.object(runner.db_client, "notify"),
            patch.object(
                runner.db_client,
                "file_exists",
                _disk("video.mp4", "audio.mp3", "summary.pdf"),
            ),
            patch.object(runner.db_client, "remove_files", remove),
        ):
            asyncio.run(runner.run_step("C1", "L1", "lecture", "pdf"))
        remove.assert_not_called()

    def test_a_locked_file_is_a_warning_not_a_failure(self, monkeypatch, clean_queue):
        _rule(monkeypatch, "video", "pdf")
        locked = runner.db_client.DbClientError("open", "file_locked", file="video.mp4")
        with (
            patch.dict(runner._EXECUTORS, {"pdf": lambda *a, **k: {"status": "done"}}),
            patch.object(runner.db_client, "notify"),
            patch.object(
                runner.db_client, "file_exists", _disk("video.mp4", "summary.pdf")
            ),
            patch.object(runner.db_client, "remove_files", side_effect=locked),
        ):
            asyncio.run(runner.run_step("C1", "L1", "lecture", "pdf"))
            assert runner.auto_remove("C1", "L1", "lecture") == "locked"
        assert runner._skey("C1", "L1", "lecture") not in runner._errors

    def test_a_pipeline_applies_the_rule_once_at_its_end(
        self, monkeypatch, clean_queue
    ):
        _rule(monkeypatch, "audio", "pdf")
        remove = Mock()
        with (
            patch.object(
                runner, "_run_pipeline_unlocked", AsyncMock(return_value=False)
            ),
            patch.object(
                runner.db_client,
                "file_exists",
                _disk("video.mp4", "audio.mp3", "summary.pdf"),
            ),
            patch.object(runner.db_client, "remove_files", remove),
        ):
            assert asyncio.run(runner.run_pipeline_for("C1", "L1", "lecture")) is False
        remove.assert_called_once_with(
            "C1", "L1", "lecture", ["video.mp4", "audio.mp3"]
        )


def _sweep_tree(*lectures: str) -> list:
    return [
        {
            "name": "C1",
            "archived": True,
            "lectures": [
                {"name": name, "files": _files(video=True, pdf=True), "removed": []}
                for name in lectures
            ],
            "recitations": [{"name": "R1", "files": _files(video=True), "removed": []}],
        }
    ]


class TestApplyAutoRemove:
    def test_counts_each_outcome(self, monkeypatch, clean_queue):
        _rule(monkeypatch, "video", "pdf")
        outcomes = {"L1": "removed", "L2": "locked", "L3": "failed"}

        async def go():
            held = runner._locks.setdefault(
                runner._lkey("C1", "L4", "lecture"), asyncio.Lock()
            )
            async with held:  # L4 is mid-run: its own hook covers it
                return await runner.apply_auto_remove()

        with (
            patch.object(
                runner.db_client,
                "get_tree",
                return_value=_sweep_tree("L1", "L2", "L3", "L4"),
            ),
            patch.object(runner, "auto_remove", lambda _c, lec, _k: outcomes[lec]),
        ):
            counts = asyncio.run(go())
        # R1 has no pdf yet, so it is not counted anywhere; the archived course is swept.
        assert counts == {"removed": 1, "locked": 1, "deferred": 1, "failed": 1}

    def test_rule_off_reads_nothing(self, monkeypatch, clean_queue):
        _rule(monkeypatch, "off", "pdf")
        with patch.object(runner.db_client, "get_tree", side_effect=AssertionError):
            counts = asyncio.run(runner.apply_auto_remove())
        assert counts == {"removed": 0, "locked": 0, "deferred": 0, "failed": 0}

    def test_triggers_during_a_removal_wait_instead_of_skipping(
        self, monkeypatch, clean_queue
    ):
        """A sweep's removal holds the lecture's lock, yet nothing that arrives meanwhile is
        refused or skipped — and only the first of two manual runs is accepted."""

        _rule(monkeypatch, "video", "pdf")
        seen: dict = {}
        ran: list = []

        def removal(course, lecture, kind):
            key = runner._lkey(course, lecture, kind)
            seen["held"] = runner._locks[key].locked()
            return "removed"

        async def fake_run_step(course, lecture, kind, step, **_):
            async with runner._locks.setdefault(
                runner._lkey(course, lecture, kind), asyncio.Lock()
            ):
                ran.append(step)

        async def go():
            release = asyncio.Event()

            async def slow_removal(fn, *args):
                if fn is runner.auto_remove:
                    result = fn(*args)
                    # Every trigger arrives while the removal still holds the lock.
                    seen["enqueue"] = runner.enqueue(_entry("L1"))
                    seen["first"] = runner.try_run_step("C1", "L1", "lecture", "drive")
                    seen["second"] = runner.try_run_step("C1", "L1", "lecture", "drive")
                    await release.wait()
                    return result
                return fn(*args)

            with patch.object(runner.asyncio, "to_thread", slow_removal):
                sweep = asyncio.create_task(runner.apply_auto_remove())
                await asyncio.sleep(0.01)
                release.set()
                await sweep
            await asyncio.sleep(0.01)

        with (
            patch.object(runner.db_client, "get_tree", return_value=_sweep_tree("L1")),
            patch.object(runner, "auto_remove", removal),
            patch.object(runner, "run_step", fake_run_step),
            patch.object(runner, "run_all", AsyncMock()),
            patch.object(runner.db_client, "notify"),
        ):
            asyncio.run(go())
        assert seen == {
            "held": True,
            "enqueue": True,
            "first": "started",
            "second": "busy",
        }
        assert ran == ["drive"]

    def test_run_all_waits_for_a_removal_instead_of_skipping(
        self, monkeypatch, clean_queue
    ):
        ran: list = []

        async def fake_entry(entry):
            async with runner._locks[
                runner._lkey(entry.course, entry.lecture, entry.kind)
            ]:
                ran.append(entry.lecture)
            return False

        async def go():
            key = runner._lkey("C1", "L1", "lecture")
            lock = runner._locks.setdefault(key, asyncio.Lock())
            async with lock:
                runner._removing.add(key)
                runner._queue.append(_entry("L1"))
                drain = asyncio.create_task(runner.run_all())
                await asyncio.sleep(0.01)
                assert ran == []  # waiting on the removal, not skipped
                runner._removing.discard(key)
            await drain

        with (
            patch.object(runner, "_run_entry", fake_entry),
            patch.object(runner.db_client, "notify"),
        ):
            asyncio.run(go())
        assert ran == ["L1"]


def test_an_audio_entry_whose_audio_was_auto_removed_has_nothing_left(clean_queue):
    """Otherwise AUTO_RUN=audio re-runs audio on a stripped lecture and fails on video.mp4."""

    tree = [
        {
            "name": "C1",
            "lectures": [
                {"name": "L1", "files": {}, "removed": ["video.mp4", "audio.mp3"]}
            ],
            "recitations": [],
        }
    ]
    step = AsyncMock()
    with (
        patch.object(
            runner.db_client, "file_exists", _disk("transcript.txt", "summary.pdf")
        ),
        patch.object(runner.db_client, "get_tree", return_value=tree),
        patch.object(runner, "run_step", step),
    ):
        assert asyncio.run(runner._run_entry(_entry("L1", "audio"))) is False
    step.assert_not_called()


def test_an_audio_entry_whose_audio_was_deleted_after_transcribe_has_nothing_left(
    clean_queue,
):
    tree = [
        {
            "name": "C1",
            "lectures": [{"name": "L1", "files": {}, "removed": ["audio.mp3"]}],
            "recitations": [],
        }
    ]
    step = AsyncMock()
    with (
        patch.object(
            runner.db_client, "file_exists", _disk("video.mp4", "transcript.txt")
        ),
        patch.object(runner.db_client, "get_tree", return_value=tree),
        patch.object(runner, "run_step", step),
    ):
        assert asyncio.run(runner._run_entry(_entry("L1", "audio"))) is False
    step.assert_not_called()


def test_a_model_fallback_in_a_step_is_noticed_on_the_pipeline_status(monkeypatch):
    import services.llm_client as llm_mod
    from services import notices

    monkeypatch.setattr(notices.db_client, "notify", lambda: None)

    def step(course, lecture, kind, **_opts):
        llm_mod.fallback_hook.get()("m1", "m2")
        return {"status": "done"}

    monkeypatch.setitem(runner._EXECUTORS, "summarize", step)

    asyncio.run(runner._call_step("c-notice", "l1", "lecture", "summarize"))

    mine = [n for n in runner.get_status()["notices"] if n["course"] == "c-notice"]
    assert len(mine) == 1
    assert mine[0]["code"] == "model_fallback"
    assert mine[0]["params"] == {"from": "m1", "to": "m2"}
    assert (mine[0]["lecture"], mine[0]["kind"]) == ("l1", "lecture")
