"""The `figures` step: marker on a failed box call, the later crop, PDF/Drive refresh, auto retry."""

import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from pipeline import runner
from pipeline import summary_figures as sf
from services.errors import CodedError

C, L, K = "C1", "L1", "lecture"
SKEY = runner._skey(C, L, K)
DECK = Path(__file__).parent.parent / "fixtures" / "econ-slides.pdf"
LINE = "![גרף](slides.pdf#page=1)"
BOX = [200, 30, 960, 500]
db = runner.db_client


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for var in ("AUTO_RETRY", "AUTO_RETRY_COUNT", "AUTO_RETRY_MINUTES"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(db, "notify", lambda: None)
    yield
    runner.cancel_all_retries()
    for state in (runner._errors, runner._attempts, runner._in_flight, runner._retries):
        state.clear()


class Store:
    """An in-memory stand-in for the database calls `_exec_figures` makes."""

    def __init__(self, summary, figures=(), original=None):
        self.summary, self.figs, self.original = summary, list(figures), original
        self.marker = True
        self.edit_during_call = None
        self.marker_delete_fails = False

    def get_summary(self, *_a):
        return self.summary

    def put_summary(self, *_a, **_k):
        raise AssertionError("a crop must not go through put_summary (it snapshots)")

    def put_file_bytes(self, c, lec, k, name, data):
        if name == "summary.md":
            self.summary = data.decode()
        else:
            assert name == "original_summary.md"
            self.original = data.decode()

    def file_exists(self, c, lec, k, name):
        return self.original is not None if name == "original_summary.md" else True

    def get_file_bytes(self, c, lec, k, name):
        if name == "original_summary.md":
            return self.original.encode()
        return DECK.read_bytes()

    def put_figure(self, c, lec, k, name, data):
        self.figs.append(name)

    def delete_file(self, c, lec, k, name):
        assert name == ".figures_pending"
        if self.marker_delete_fails:
            raise RuntimeError("locked")
        self.marker = False


def _run(store, boxes, monkeypatch, summary_exists=True, materials=("slides.pdf",)):
    monkeypatch.setattr(
        db, "file_exists", lambda *a: summary_exists and store.file_exists(*a)
    )
    monkeypatch.setattr(db, "put_file_bytes", store.put_file_bytes)
    monkeypatch.setattr(db, "get_summary", store.get_summary)
    monkeypatch.setattr(db, "put_summary", store.put_summary)
    monkeypatch.setattr(db, "put_figure", store.put_figure)
    monkeypatch.setattr(db, "delete_file", store.delete_file)
    monkeypatch.setattr(db, "list_figures", lambda *a: list(store.figs))
    monkeypatch.setattr(
        db, "list_materials", lambda *a: [{"name": n} for n in materials]
    )
    monkeypatch.setattr(db, "get_file_bytes", store.get_file_bytes)

    def fake_boxes(wanted):
        if store.edit_during_call:
            store.summary = store.edit_during_call
        if isinstance(boxes, Exception):
            raise boxes
        return {i: boxes for i, *_ in wanted}

    with patch.object(sf, "request_boxes", fake_boxes):
        return runner._exec_figures(C, L, K)


class TestExecFigures:
    def test_crops_numbers_after_the_highest_figure_and_drops_the_marker(
        self, monkeypatch
    ):
        store = Store(f"a\n\n![p](figures/fig3.png)\n\n{LINE}\n", ["fig3.png"])
        result = _run(store, BOX, monkeypatch)
        assert result == {"status": "done", "changed": True}
        assert store.figs == ["fig3.png", "fig4.pdf"]
        assert (
            "![גרף](figures/fig4.pdf)" in store.summary
            and "slides.pdf" not in store.summary
        )
        assert "![p](figures/fig3.png)" in store.summary
        assert store.marker is False

    def test_an_edit_saved_during_the_box_call_survives(self, monkeypatch):
        store = Store(f"a\n\n{LINE}\n")
        store.edit_during_call = f"EDITED\n\n{LINE}\n"
        _run(store, BOX, monkeypatch)
        assert (
            store.summary.startswith("EDITED") and "figures/fig1.pdf" in store.summary
        )

    def test_a_never_edited_summary_gets_no_original(self, monkeypatch):
        store = Store(f"a\n\n{LINE}\n")
        _run(store, BOX, monkeypatch)
        assert store.original is None

    def test_an_existing_original_gets_the_crops_too(self, monkeypatch):
        store = Store(f"edited\n\n{LINE}\n", original=f"orig\n\n{LINE}\n")
        _run(store, BOX, monkeypatch)
        assert store.original == "orig\n\n![גרף](figures/fig1.pdf)\n"

    def test_a_line_edited_mid_call_keeps_the_marker(self, monkeypatch):
        store = Store(f"a\n\n{LINE}\n\n![גרף](slides.pdf#page=2)\n")
        store.edit_during_call = f"a\n\n{LINE}\n\n![גרף שונה](slides.pdf#page=2)\n"
        result = _run(store, BOX, monkeypatch)
        assert result["changed"] and store.marker is True
        assert "![גרף שונה](slides.pdf#page=2)" in store.summary
        assert "figures/fig1.pdf" in store.summary

    def test_a_failed_marker_delete_still_reports_a_change(self, monkeypatch):
        store = Store(f"a\n\n{LINE}\n")
        store.marker_delete_fails = True
        result = _run(store, BOX, monkeypatch)
        assert result == {"status": "done", "changed": True}

    def test_a_link_the_user_deleted_is_left_alone(self, monkeypatch):
        store = Store(f"a\n\n{LINE}\n")
        store.edit_during_call = "a\n\nmine\n"
        _run(store, BOX, monkeypatch)
        assert store.summary == "a\n\nmine\n"

    def test_no_links_left_drops_the_marker_with_no_gemini_call(self, monkeypatch):
        store = Store("just text\n")
        result = _run(store, RuntimeError("must not be called"), monkeypatch)
        assert result == {"status": "done", "changed": False}
        assert store.marker is False

    def test_a_vanished_summary_ends_quietly(self, monkeypatch):
        store = Store("")
        result = _run(store, RuntimeError("no call"), monkeypatch, summary_exists=False)
        assert result == {"status": "done", "changed": False}

    def test_an_unknown_material_drops_its_line(self, monkeypatch):
        store = Store(f"a\n\n{LINE}\n\n![x](other.pdf#page=1)\n")
        _run(store, BOX, monkeypatch)
        assert "other.pdf" not in store.summary and "figures/fig1.pdf" in store.summary

    def test_a_failed_box_call_changes_nothing_and_keeps_the_marker(self, monkeypatch):
        store = Store(f"a\n\n{LINE}\n")
        result = _run(store, RuntimeError("503"), monkeypatch)
        assert result["status"] == "error"
        assert result["code"] == "figure_boxes_failed" and result["params"] == {
            "detail": "503"
        }
        assert store.summary == f"a\n\n{LINE}\n" and store.figs == [] and store.marker

    def test_a_quota_failure_keeps_its_code(self, monkeypatch):
        store = Store(f"{LINE}\n")
        err = CodedError("q", "gemini_quota_exhausted", scope="per_minute")
        assert _run(store, err, monkeypatch)["code"] == "gemini_quota_exhausted"


@pytest.mark.usefixtures("real_marker")
class TestMarker:
    def _summarize(self, monkeypatch, failed, setting_on=True, kind=K):
        put, delete = MagicMock(), MagicMock()
        monkeypatch.setattr(db, "put_file_bytes", put)
        monkeypatch.setattr(db, "delete_file", delete)
        monkeypatch.setattr(db, "put_summary", MagicMock())
        monkeypatch.setattr(db, "file_exists", lambda *a: True)
        monkeypatch.setattr(db, "list_materials", lambda *a: [])
        monkeypatch.setattr(db, "get_file_bytes", lambda *a: b"t")
        sources = sf.FigureSources() if setting_on else None
        monkeypatch.setattr(runner, "_figure_sources", lambda k: sources)

        def fake(transcript, paths, figures=None):
            if figures is not None and failed:
                figures.boxes_failed = CodedError(
                    "b", "figure_boxes_failed", detail="x"
                )
            return "# s"

        monkeypatch.setattr(runner, "summarize", fake)
        return runner._exec_summarize(C, L, kind), put, delete

    def test_a_failed_box_call_writes_the_marker_and_reports_it(self, monkeypatch):
        result, put, delete = self._summarize(monkeypatch, True)
        put.assert_called_once_with(C, L, K, ".figures_pending", b"")
        assert result["figures_failed"]["code"] == "figure_boxes_failed"

    def test_otherwise_the_marker_is_dropped_even_with_the_setting_off(
        self, monkeypatch
    ):
        for on in (True, False):
            result, put, delete = self._summarize(monkeypatch, False, setting_on=on)
            put.assert_not_called()
            delete.assert_called_with(C, L, K, ".figures_pending")
            assert "figures_failed" not in result

    def test_a_marker_failure_never_fails_the_step(self, monkeypatch):
        put = MagicMock(side_effect=RuntimeError("db"))
        monkeypatch.setattr(db, "put_file_bytes", put)
        assert runner._set_figures_pending(C, L, K, True) is False

    def test_a_marker_failure_arms_no_retry(self, monkeypatch):
        monkeypatch.setattr(
            db, "put_file_bytes", MagicMock(side_effect=RuntimeError("x"))
        )
        assert runner._set_figures_pending(C, L, K, True) is False


def _step_results(plan, calls):
    async def fake_call(course, lecture, kind, step, **_o):
        calls.append(step)
        return plan[step]

    return patch.object(runner, "_call_step", fake_call)


class TestChain:
    def _go(self, plan, files, drive=True, monkeypatch=None):
        calls = []
        monkeypatch.setattr(db, "file_exists", lambda c, lec, k, n: n in files)
        monkeypatch.setattr(runner.settings, "drive_enabled", lambda: drive)
        with _step_results(plan, calls):
            asyncio.run(runner.run_step(C, L, K, "figures"))
        return calls

    changed = {"status": "done", "changed": True}
    ok = {"status": "done"}

    def test_pdf_and_drive_follow_a_change(self, monkeypatch):
        plan = {"figures": self.changed, "pdf": self.ok, "drive": self.ok}
        calls = self._go(
            plan, {"summary.pdf", "drive_url.txt"}, monkeypatch=monkeypatch
        )
        assert calls == ["figures", "pdf", "drive"] and SKEY not in runner._in_flight

    def test_no_pdf_means_no_render_and_no_drive_without_url(self, monkeypatch):
        plan = {"figures": self.changed, "pdf": self.ok, "drive": self.ok}
        assert self._go(plan, set(), monkeypatch=monkeypatch) == ["figures"]
        assert self._go(plan, {"summary.pdf"}, monkeypatch=monkeypatch) == [
            "figures",
            "pdf",
        ]
        assert self._go(
            plan, {"summary.pdf", "drive_url.txt"}, drive=False, monkeypatch=monkeypatch
        ) == ["figures", "pdf"]

    def test_unchanged_summary_skips_the_refresh(self, monkeypatch):
        plan = {"figures": {"status": "done", "changed": False}}
        assert self._go(plan, {"summary.pdf"}, monkeypatch=monkeypatch) == ["figures"]

    def test_a_pdf_failure_records_its_error_and_skips_drive(self, monkeypatch):
        plan = {"figures": self.changed, "pdf": {"status": "error", "message": "x"}}
        calls = self._go(
            plan, {"summary.pdf", "drive_url.txt"}, monkeypatch=monkeypatch
        )
        assert calls == ["figures", "pdf"] and runner._errors[SKEY]["step"] == "pdf"

    def test_figures_is_in_no_step_list(self):
        assert (
            "figures" not in runner.enabled_steps()
            and "figures" not in runner.STEP_ORDER
        )


FAILED = {"message": "b", "code": "gemini_overloaded", "params": {"model": "m"}}


class TestAutoRetry:
    def test_armed_after_a_lone_summarize_that_left_the_marker(self):
        async def go():
            r = {"status": "done", "figures_failed": FAILED}
            with _step_results({"summarize": r}, []):
                await runner.run_step(C, L, K, "summarize")
            rec = runner._errors[SKEY]
            assert rec["step"] == "figures" and rec["code"] == "gemini_overloaded"
            assert (
                rec["retry"]["attempt"] == 1
                and runner._retries[SKEY]["step"] == "figures"
            )
            assert runner._retries[SKEY]["origin"] == "step"

        asyncio.run(go())

    def test_armed_only_once_the_pipeline_has_finished_its_steps(self):

        async def go():
            seen = []
            fetched = iter(
                [
                    _files(video=True, audio=True, transcript=True),
                    _files(video=True, audio=True, transcript=True, summary=True),
                    _files(
                        video=True,
                        audio=True,
                        transcript=True,
                        summary=True,
                        pdf=True,
                        drive=True,
                    ),
                ]
            )

            async def fake_fetch(*_a):
                seen.append(SKEY in runner._errors)
                return next(fetched)

            plan = {
                "summarize": {"status": "done", "figures_failed": FAILED},
                "pdf": {"status": "done"},
            }
            with (
                patch.object(runner, "_fetch_files", fake_fetch),
                _step_results(plan, []),
            ):
                await runner.run_pipeline_for(C, L, K)
            assert seen == [False, False, False]
            assert (
                runner._errors[SKEY]["step"] == "figures"
                and "retry" in runner._errors[SKEY]
            )

        asyncio.run(go())

    def test_a_non_transient_failure_arms_nothing(self):
        async def go():
            bad = {
                "message": "b",
                "code": "figure_boxes_failed",
                "params": {"detail": "x"},
            }
            with _step_results(
                {"summarize": {"status": "done", "figures_failed": bad}}, []
            ):
                await runner.run_step(C, L, K, "summarize")
            assert runner._retries == {} and "retry" not in runner._errors[SKEY]

        asyncio.run(go())

    def test_a_failed_figures_run_goes_through_the_normal_schedule(self):
        async def go():
            err = {
                "status": "error",
                "message": "b",
                "code": "gemini_overloaded",
                "params": {},
            }
            with _step_results({"figures": err}, []):
                await runner.run_step(C, L, K, "figures")
            assert runner._errors[SKEY]["retry"]["attempt"] == 1

        asyncio.run(go())

    def test_a_figures_error_does_not_make_the_lecture_pending(self):
        runner._errors[SKEY] = runner._error_record(
            "figures", "x", code="gemini_overloaded"
        )
        files = _files(
            video=True, audio=True, transcript=True, summary=True, pdf=True, drive=True
        )
        assert not runner._lecture_pending(files)
        assert runner.next_step(files) is None


def _files(**kw):
    names = {
        "video": "video.mp4",
        "audio": "audio.mp3",
        "transcript": "transcript.txt",
        "summary": "summary.md",
        "pdf": "summary.pdf",
        "drive": "drive_url.txt",
    }
    return {n: {"exists": bool(kw.get(k))} for k, n in names.items()}
