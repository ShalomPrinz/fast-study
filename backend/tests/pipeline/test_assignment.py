import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import summarize as summarize_mod
from pipeline import runner
from services.db_client import DbClientError

PDF = {"name": "hw.pdf", "size": 10}


def _entry(files=(PDF,), lectures=()):
    return {"name": "A1", "files": list(files), "lectures": list(lectures), "docs": {}}


def _inputs(entry, summaries=None, tmp_path=None):
    """Run _assignment_inputs with the database faked; `summaries` maps lecture name → text or error."""

    summaries = summaries or {}

    def get_summary(_course, name, _kind):
        value = summaries[name]
        if isinstance(value, Exception):
            raise value
        return value

    with (
        patch.object(
            runner.db_client, "get_assignment_file_bytes", return_value=b"data"
        ) as fetch,
        patch.object(runner.db_client, "get_summary", side_effect=get_summary),
    ):
        return runner._assignment_inputs("C", entry, tmp_path), fetch


class TestInputs:
    def test_sends_attached_files_and_chosen_summaries(self, tmp_path):
        entry = _entry(lectures=[{"name": "L1", "kind": "lecture"}])
        (files, summaries), _ = _inputs(entry, {"L1": "# sum"}, tmp_path)
        assert [(p.name, m) for p, m in files] == [("hw.pdf", "application/pdf")]
        assert summaries == [("lecture", "L1", "# sum")]

    def test_a_switched_off_file_is_not_sent(self, tmp_path):
        entry = _entry(files=[PDF, {"name": "b.txt", "size": 1, "attach": False}])
        (files, _), fetch = _inputs(entry, tmp_path=tmp_path)
        assert [p.name for p, _ in files] == ["hw.pdf"]
        fetch.assert_called_once_with("C", "A1", "hw.pdf")

    def test_an_unsupported_type_is_not_sent(self, tmp_path):
        entry = _entry(files=[PDF, {"name": "a.zip", "size": 1}])
        (files, _), _ = _inputs(entry, tmp_path=tmp_path)
        assert [p.name for p, _ in files] == ["hw.pdf"]

    def test_a_file_over_the_cap_is_material_too_large(self, tmp_path):
        entry = _entry(files=[{"name": "big.pdf", "size": 11 * 1024 * 1024}])
        with pytest.raises(runner.CodedError) as exc:
            _inputs(entry, tmp_path=tmp_path)
        assert exc.value.code == "material_too_large"

    def test_a_vanished_or_summaryless_lecture_is_skipped(self, tmp_path, caplog):
        entry = _entry(
            lectures=[
                {"name": "gone", "kind": "lecture"},
                {"name": "bare", "kind": "recitation"},
                {"name": "ok", "kind": "lecture"},
            ]
        )
        summaries = {
            "gone": DbClientError("x", "lecture_not_found"),
            "bare": DbClientError("x", "file_not_found"),
            "ok": "text",
        }
        with caplog.at_level("INFO", logger="runner"):
            (_, got), _ = _inputs(entry, summaries, tmp_path)
        assert got == [("lecture", "ok", "text")]
        assert "skipping lecture gone" in caplog.text

    def test_a_storage_outage_is_not_swallowed(self, tmp_path):
        entry = _entry(lectures=[{"name": "L", "kind": "lecture"}])
        with pytest.raises(DbClientError):
            _inputs(entry, {"L": DbClientError("down", "storage_error")}, tmp_path)

    def test_nothing_left_is_assignment_inputs_empty(self, tmp_path):
        entry = _entry(
            files=[{"name": "b.pdf", "size": 1, "attach": False}],
            lectures=[{"name": "bare", "kind": "lecture"}],
        )
        with pytest.raises(runner.CodedError) as exc:
            _inputs(entry, {"bare": DbClientError("x", "file_not_found")}, tmp_path)
        assert exc.value.code == "assignment_inputs_empty"


def _run_doc(**patches):
    fake_gemini = patches.pop("generate", MagicMock(return_value="# guide"))
    with (
        patch.object(runner.db_client, "get_assignment", return_value=_entry()),
        patch.object(runner.db_client, "get_assignment_file_bytes", return_value=b"d"),
        patch.object(runner, "generate_assignment_doc", fake_gemini),
        patch.object(runner.db_client, "put_assignment_doc") as put,
        patch.object(
            runner, "_exec_assignment_pdf", return_value={"status": "done"}
        ) as pdf,
    ):
        result = runner._ASSIGNMENT_EXECUTORS["intuition"]("C", "A1")
    return result, put, pdf


class TestDocStep:
    def test_writes_a_fresh_doc_then_renders_its_pdf(self):
        result, put, pdf = _run_doc()
        assert result == {"status": "done"}
        put.assert_called_once_with("C", "A1", "intuition", "# guide", fresh=True)
        pdf.assert_called_once_with("C", "A1", doc="intuition")

    def test_empty_text_is_empty_file(self):
        result, put, pdf = _run_doc(generate=MagicMock(return_value=""))
        assert result["code"] == "empty_file"
        assert result["params"] == {"file": "intuition.md"}
        put.assert_not_called()
        pdf.assert_not_called()

    def test_a_daily_quota_is_a_plain_error_without_the_block_flag(self):
        from services.llm_client import GeminiRateLimitError

        info = {"is_daily": True, "message": "q", "model": "m"}
        boom = MagicMock(side_effect=GeminiRateLimitError(info))
        result, _, _ = _run_doc(generate=boom)
        assert result["code"] == "gemini_quota_exhausted"
        assert "daily_quota" not in result

    def test_run_step_never_sets_the_summarize_block_or_sweeps_records(self):
        other = runner._skey("C", "L", "lecture")
        runner._errors[other] = runner._error_record(
            "summarize", "q", code="gemini_quota_exhausted"
        )

        async def fake_call(*_a, **_k):
            return {
                "status": "error",
                "message": "q",
                "code": "gemini_quota_exhausted",
                "params": {},
                "daily_quota": True,
            }

        async def go():
            with (
                patch.object(runner, "_call_step", fake_call),
                patch.object(runner.db_client, "notify"),
            ):
                await runner._run_step_unlocked("C", "A1", "assignment", "intuition")

        try:
            asyncio.run(go())
            assert runner._summarize_block is None
            assert other in runner._errors
            assert (
                runner._errors[runner._skey("C", "A1", "assignment")]["provider"]
                == "gemini"
            )
        finally:
            runner._errors.clear()
            runner._summarize_block = None

    def test_an_assignment_run_skips_auto_remove_and_the_queue(self):
        async def go():
            release = asyncio.Event()

            async def held(*_a, **_k):
                await release.wait()

            with (
                patch.object(runner, "_run_step_unlocked", held),
                patch.object(runner, "auto_remove") as remove,
            ):
                assert (
                    runner.try_run_assignment_step("C", "A1", "intuition") == "started"
                )
                await asyncio.sleep(0)
                assert runner.try_run_assignment_step("C", "A1", "solution") == "busy"
                release.set()
                await asyncio.sleep(0.05)
                remove.assert_not_called()
                assert runner._queue == []

        runner._locks.clear()
        asyncio.run(go())
        runner._locks.clear()


class TestPdfStep:
    def _run(self, *, fresh, warning=None):
        def fake_convert(md_path):
            from pathlib import Path

            pdf = Path(md_path).with_suffix(".pdf")
            pdf.write_bytes(b"%PDF")
            return str(pdf), warning

        with (
            patch.object(runner.db_client, "get_assignment_doc", return_value="# x"),
            patch.object(runner, "convert_to_pdf", fake_convert),
            patch.object(runner.db_client, "delete_generated") as delete,
            patch.object(runner.db_client, "put_generated") as put,
            patch.object(runner.db_client, "notify"),
        ):
            result = runner._exec_assignment_pdf("C", "A1", doc="solution", fresh=fresh)
        return result, delete, put

    def test_fresh_deletes_the_old_pdf_first(self):
        result, delete, put = self._run(fresh=True)
        assert result == {"status": "done"}
        assert delete.call_args_list[0].args == ("C", "A1", "solution.pdf")
        put.assert_called_once_with("C", "A1", "solution.pdf", b"%PDF")

    def test_not_fresh_does_not_delete_the_pdf(self):
        _, delete, _ = self._run(fresh=False)
        assert [c.args[2] for c in delete.call_args_list] == [
            "solution.pdf_warning",
            "solution.pdf_build.tex",
        ]

    def test_a_warning_is_stored_beside_the_pdf(self):
        _, _, put = self._run(fresh=False, warning="careful")
        assert put.call_args_list[1].args == (
            "C",
            "A1",
            "solution.pdf_warning",
            b"careful",
        )

    def test_missing_markdown_is_missing_prerequisite(self):
        with patch.object(
            runner.db_client,
            "get_assignment_doc",
            side_effect=DbClientError("x", "file_not_found"),
        ):
            result = runner._exec_assignment_pdf("C", "A1", doc="solution")
        assert result["code"] == "missing_prerequisite"
        assert result["params"] == {"file": "solution.md", "step": "solution"}


def test_prune_keeps_the_error_of_a_live_assignment_only():
    live = runner._skey("C", "A1", "assignment")
    gone = runner._skey("C", "A2", "assignment")
    tree = [{"name": "C", "lectures": [], "assignments": [{"name": "A1"}]}]
    try:
        for key in (live, gone):
            runner._errors[key] = runner._error_record("intuition", "b", code="x")
        with patch.object(runner.db_client, "get_tree", return_value=tree):
            asyncio.run(runner.prune_stale_errors())
        assert list(runner._errors) == [live]
    finally:
        runner._errors.clear()


def test_the_empty_file_hints_cover_both_docs():
    for name in ("intuition.md", "solution.md"):
        assert runner.EMPTY_FILE_ISSUES[name] == "Gemini returned no text"


class TestGenerateAssignmentDoc:
    def test_orders_files_summaries_then_the_prompt_and_names_its_failure(
        self, tmp_path
    ):
        f = tmp_path / "hw.pdf"
        f.write_bytes(b"1234")
        fake = MagicMock()
        fake.upload_file.return_value = SimpleNamespace(name="files/1")
        fake.generate.return_value = "# out"
        with patch.object(summarize_mod, "LLMClient", return_value=fake):
            out = summarize_mod.generate_assignment_doc(
                "solution", [(f, "application/pdf")], [("lecture", "L1", "txt")]
            )
        assert out == "# out"
        contents = fake.generate.call_args.args[0]
        assert contents[0] == summarize_mod.ASSIGNMENT_FILES_MARKER
        assert contents[2] == summarize_mod.COURSE_SUMMARIES_MARKER
        assert contents[3] == '<lecture kind="lecture" title="L1">txt</lecture>'
        assert contents[4] == summarize_mod.INSTRUCTIONS_MARKER
        assert contents[5].startswith("# Assignment Full Solution Instructions")
        fake.delete_file.assert_called_once_with("files/1")

        fake.generate.side_effect = RuntimeError("boom")
        with patch.object(summarize_mod, "LLMClient", return_value=fake):
            with pytest.raises(summarize_mod.CodedError) as exc:
                summarize_mod.generate_assignment_doc(
                    "intuition", [], [("lecture", "L", "t")]
                )
        assert exc.value.code == "assignment_generation_failed"
        assert exc.value.params == {"detail": "boom"}

        coded = summarize_mod.CodedError("down", "gemini_unreachable", model="m")
        fake.generate.side_effect = coded
        with patch.object(summarize_mod, "LLMClient", return_value=fake):
            with pytest.raises(summarize_mod.CodedError) as exc:
                summarize_mod.generate_assignment_doc(
                    "intuition", [], [("lecture", "L", "t")]
                )
        assert exc.value is coded

    def test_records_the_summed_input_bytes(self, tmp_path):
        import timing

        f = tmp_path / "hw.pdf"
        f.write_bytes(b"1234")
        fake = MagicMock()
        fake.upload_file.return_value = SimpleNamespace(name="files/1")
        fake.generate.return_value = "# out"
        with (
            patch.object(summarize_mod, "LLMClient", return_value=fake),
            patch.object(timing, "_record") as rec,
        ):
            summarize_mod.generate_assignment_doc(
                "intuition", [(f, "application/pdf")], [("lecture", "L", "אב")]
            )
        assert rec.call_args.args[:2] == ("assignment_intuition", 4 + 4)


def test_timing_accepts_both_assignment_operations():
    import timing

    for op in ("assignment_intuition", "assignment_solution"):
        assert timing.record(op, 10, 1.0) == {"status": "ok"}
