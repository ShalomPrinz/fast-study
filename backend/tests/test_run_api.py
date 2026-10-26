import asyncio
import threading
from concurrent.futures import Future
from unittest.mock import patch

import backend_main
from fastapi.testclient import TestClient
from services.db_client import DbClientError

client = TestClient(backend_main.app)


class TestRunStep:
    def test_unknown_step_is_a_404(self):
        response = client.post("/courses/C/lectures/L/run/nope")
        assert response.status_code == 404
        assert response.json() == {
            "error": "Unknown step: nope",
            "code": "unknown_step",
            "params": {"step": "nope"},
        }

    def test_missing_prerequisite_is_a_409(self):
        with (
            patch.object(
                backend_main.runner.db_client, "file_exists", return_value=False
            ),
            patch.object(backend_main.runner, "try_run_step") as run,
        ):
            response = client.post("/courses/C/lectures/L/run/pdf")
        assert response.status_code == 409
        assert response.json() == {
            "error": "summary.md is required — run Summarize first",
            "code": "missing_prerequisite",
            # The machine step id, not the "Summarize" label the sentence carries.
            "params": {"file": "summary.md", "step": "summarize"},
        }
        run.assert_not_called()

    def test_summarize_is_accepted_for_a_materials_only_lecture(self):
        with (
            patch.object(
                backend_main.runner.db_client, "file_exists", return_value=False
            ),
            patch.object(
                backend_main.runner.db_client,
                "list_materials",
                return_value=[{"name": "material.pdf"}],
            ),
            patch.object(
                backend_main.runner, "try_run_step", return_value="started"
            ) as run,
        ):
            response = client.post("/courses/C/lectures/L/run/summarize")
        assert response.status_code == 200
        assert response.json() == {"status": "started"}
        run.assert_called_once_with("C", "L", "lecture", "summarize", fresh=False)

    def test_summarize_with_audio_but_no_transcript_is_a_409(self):
        with (
            patch.object(
                backend_main.runner.db_client,
                "file_exists",
                side_effect=lambda c, l, k, name: name == "audio.mp3",
            ),
            patch.object(
                backend_main.runner.db_client,
                "list_materials",
                return_value=[{"name": "material.pdf"}],
            ),
            patch.object(backend_main.runner, "try_run_step") as run,
        ):
            response = client.post("/courses/C/lectures/L/run/summarize")
        assert response.status_code == 409
        assert response.json()["code"] == "missing_prerequisite"
        assert response.json()["params"] == {
            "file": "transcript.txt",
            "step": "transcribe",
        }
        run.assert_not_called()

    def test_summarize_with_a_video_but_no_transcript_is_a_409(self):
        with (
            patch.object(
                backend_main.runner.db_client,
                "file_exists",
                side_effect=lambda c, l, k, name: name == "video.mp4",
            ),
            patch.object(
                backend_main.runner.db_client,
                "list_materials",
                return_value=[{"name": "material.pdf"}],
            ),
            patch.object(backend_main.runner, "try_run_step") as run,
        ):
            response = client.post("/courses/C/lectures/L/run/summarize")
        assert response.status_code == 409
        assert response.json() == {
            "error": "transcript.txt is required — run Transcribe first",
            "code": "missing_prerequisite",
            "params": {"file": "transcript.txt", "step": "transcribe"},
        }
        run.assert_not_called()

    def test_an_unreachable_database_is_a_readable_500(self):
        """With database/ down the prerequisite check raises out of the route; the body still
        parses, which is the whole point of the app-level backstop."""

        with patch.object(
            backend_main.runner.db_client,
            "file_exists",
            side_effect=DbClientError("connection refused", "storage_error"),
        ):
            response = client.post("/courses/C/lectures/L/run/pdf")
        assert response.status_code == 500
        assert response.json() == {
            "error": "connection refused",
            "code": "storage_unavailable",
            "params": {"detail": "connection refused"},
        }

    def test_an_invalid_kind_is_fastapi_s_own_422(self):
        response = client.post("/courses/C/lectures/L/run/pdf?kind=zzz")
        assert response.status_code == 422
        assert "detail" in response.json()


class TestQueueFront:
    def test_returns_the_runner_status_for_the_kind_asked(self):
        with patch.object(
            backend_main.runner, "move_to_front", return_value="moved"
        ) as move:
            response = client.post("/courses/C/lectures/L/queue/front?kind=recitation")
        assert response.status_code == 200
        assert response.json() == {"status": "moved"}
        move.assert_called_once_with("C", "L", "recitation")


class TestOverviewGenerate:
    def test_unknown_from_phase_is_a_400(self):
        response = client.post("/courses/C/overview/generate?from_phase=zzz")
        assert response.status_code == 400
        assert response.json() == {
            "error": "unknown phase: zzz",
            "code": "unknown_phase",
            "params": {"phase": "zzz"},
        }

    def test_unknown_extractor_is_a_400(self):
        response = client.post("/courses/C/overview/generate?extractors=nope")
        assert response.status_code == 400
        assert response.json() == {
            "error": "unknown extractor(s): nope",
            "code": "unknown_extractors",
            "params": {"slugs": "nope"},
        }

    def test_unknown_course_is_a_404(self):
        with patch.object(backend_main.db_client, "get_tree", return_value=[]):
            response = client.post("/courses/C/overview/generate")
        assert response.status_code == 404
        assert response.json() == {
            "error": "course not found: C",
            "code": "course_not_found",
            "params": {"course": "C"},
        }

    def test_an_unconfigured_data_root_is_a_409_naming_the_refusal(self):
        """The storage answered and refused for a reason the user can fix, so the route re-emits
        the peer's own code rather than letting the backstop call the storage unreachable."""

        with patch.object(
            backend_main.db_client,
            "get_tree",
            side_effect=DbClientError(
                "No data folder is configured", "data_root_not_configured"
            ),
        ):
            response = client.post("/courses/C/overview/generate")
        assert response.status_code == 409
        assert response.json() == {
            "error": "No data folder is configured",
            "code": "data_root_not_configured",
            "params": {},
        }

    def test_any_other_storage_failure_stays_the_500_backstop(self):
        with patch.object(
            backend_main.db_client,
            "get_tree",
            side_effect=DbClientError("connection refused", "storage_error"),
        ):
            response = client.post("/courses/C/overview/generate")
        assert response.status_code == 500
        assert response.json() == {
            "error": "connection refused",
            "code": "storage_unavailable",
            "params": {"detail": "connection refused"},
        }


class TestRunAll:
    def test_an_unconfigured_data_root_is_a_409_naming_the_refusal(self):
        with patch.object(
            backend_main.runner.db_client,
            "get_tree",
            side_effect=DbClientError(
                "No data folder is configured", "data_root_not_configured"
            ),
        ):
            response = client.post("/run-all")
        assert response.status_code == 409
        assert response.json()["code"] == "data_root_not_configured"

    def test_any_other_storage_failure_stays_the_500_backstop(self):
        with patch.object(
            backend_main.runner.db_client,
            "get_tree",
            side_effect=DbClientError("connection refused", "storage_error"),
        ):
            response = client.post("/run-all")
        assert response.status_code == 500
        assert response.json()["code"] == "storage_unavailable"

    def test_a_live_run_takes_the_other_pending_lectures(self, monkeypatch):
        """Mid-run, the in-flight lecture is skipped and the rest join the drain — no second one."""
        r = backend_main.runner
        monkeypatch.setattr(
            r,
            "_runner_status",
            {"running": True, "total": 1, "done": 0, "last_error": None},
        )
        monkeypatch.setattr(r, "_in_flight", {r._skey("C", "A", "lecture"): {}})
        monkeypatch.setattr(r, "_queue", [])
        pending = {"video.mp4": {"exists": True}}
        tree = [
            {
                "name": "C",
                "lectures": [
                    {"name": "A", "files": pending},
                    {"name": "B", "files": pending},
                ],
            }
        ]
        with (
            patch.object(r.db_client, "get_tree", return_value=tree),
            patch.object(r.db_client, "notify"),
            patch.object(r, "run_all") as drain,
        ):
            response = client.post("/run-all")
        assert response.json()["status"] == "started"
        assert [e[:3] for e in r._queue] == [("C", "B", "lecture")]
        assert r._runner_status["total"] == 2
        drain.assert_not_called()

    def test_joining_a_live_run_clears_its_provider_blocks(self, monkeypatch):
        """A run-all mid-run lifts the quota blocks, so a swapped key gets tried on what it adds."""
        r = backend_main.runner
        monkeypatch.setattr(
            r,
            "_runner_status",
            {"running": True, "total": 1, "done": 0, "last_error": None},
        )
        monkeypatch.setattr(r, "_in_flight", {})
        monkeypatch.setattr(r, "_queue", [])
        monkeypatch.setattr(r, "_summarize_block", {"message": "quota", "params": {}})
        monkeypatch.setattr(r, "_transcribe_block", {"message": "rate", "params": {}})
        tree = [
            {
                "name": "C",
                "lectures": [{"name": "B", "files": {"video.mp4": {"exists": True}}}],
            }
        ]
        with (
            patch.object(r.db_client, "get_tree", return_value=tree),
            patch.object(r.db_client, "notify"),
            patch.object(r, "run_all"),
        ):
            response = client.post("/run-all")
        assert response.json()["status"] == "started"
        assert r._summarize_block is None
        assert r._transcribe_block is None
        assert [e[:3] for e in r._queue] == [("C", "B", "lecture")]


class TestHealth:
    def test_health_is_liveness_only(self):
        assert client.get("/health").json() == {"status": "ok"}


def _settled(status) -> Future:
    probe = Future()
    probe.set_result(status)
    return probe


class TestTools:
    def test_a_failed_tool_probe_passes_through_unchanged(self):
        """The probe record is lib/tools' to shape; /tools relays it and re-words nothing."""

        record = {
            "code": "tool_missing",
            "state": "missing",
            "params": {"tool": "tectonic"},
        }
        tools = {"ffmpeg": "ok", "tectonic": record}
        with patch.object(backend_main, "_tool_probe", _settled(tools)):
            body = client.get("/tools").json()
        assert body == {"tools": tools}

    def test_waits_for_a_probe_still_running(self):
        """A call before the probe settles waits for it rather than answering a partial result."""

        probe = Future()
        threading.Timer(0.2, probe.set_result, args=({"ffmpeg": "ok"},)).start()
        with patch.object(backend_main, "_tool_probe", probe):
            body = client.get("/tools").json()
        assert body == {"tools": {"ffmpeg": "ok"}}

    def test_a_cancelled_waiter_leaves_the_probe_intact(self):
        """A request cancelled mid-probe must not cancel the shared Future for every later call."""

        release = threading.Event()

        def slow_check(_names):
            release.wait(5)
            return {"ffmpeg": "ok"}

        async def cancel_one_waiter(probe):
            waiter = asyncio.ensure_future(asyncio.wrap_future(probe))
            await asyncio.sleep(0)
            waiter.cancel()
            await asyncio.sleep(0)

        with patch.object(backend_main, "check_tools", slow_check):
            probe = backend_main._start_tool_probe()
            asyncio.run(cancel_one_waiter(probe))
            release.set()
            assert probe.result(timeout=5) == {"ffmpeg": "ok"}


def test_status_keeps_a_step_error_on_a_lecture_without_a_video():
    """A transcript-only lecture whose summarize failed still shows that error on GET /status."""
    skey = backend_main.runner._skey("C1", "L1", "lecture")
    tree = [
        {
            "name": "C1",
            "lectures": [{"name": "L1", "files": {"transcript.txt": {"exists": True}}}],
        }
    ]
    backend_main.runner._errors[skey] = backend_main.runner._error_record(
        "summarize", "boom", code="x"
    )
    try:
        with patch.object(backend_main.runner.db_client, "get_tree", return_value=tree):
            body = client.get("/status").json()
        assert body["errors"][skey]["step"] == "summarize"
    finally:
        backend_main.runner._errors.clear()


class TestStatus:
    def test_prunes_errors_on_the_loop_and_fetches_the_tree_off_it(self):
        """_errors is mutated unlocked by the loop, so /status may only touch it from there."""

        def on_loop():
            try:
                asyncio.get_running_loop()
                return True
            except RuntimeError:
                return False

        seen = {}

        class LoopOnlyDict(dict):
            def __delitem__(self, key):
                seen["delete_on_loop"] = on_loop()
                super().__delitem__(key)

        def get_tree():
            seen["fetch_on_loop"] = on_loop()
            return []

        skey = backend_main.runner._skey("C", "Gone", "lecture")
        errors = LoopOnlyDict({skey: backend_main.runner._error_record("pdf", "x")})
        with (
            patch.object(backend_main.runner, "_errors", errors),
            patch.object(backend_main.runner.db_client, "get_tree", get_tree),
        ):
            response = client.get("/status")
        assert response.status_code == 200
        assert response.json()["errors"] == {}
        assert seen == {"delete_on_loop": True, "fetch_on_loop": False}


class TestFreshFlag:
    @staticmethod
    def _post(path: str):
        with (
            patch.object(
                backend_main.runner.db_client, "file_exists", return_value=True
            ),
            patch.object(
                backend_main.runner, "try_run_step", return_value="started"
            ) as run,
        ):
            assert client.post(path).json() == {"status": "started"}
        return run

    def test_fresh_reaches_the_pdf_step(self):
        run = self._post("/courses/C/lectures/L/run/pdf?fresh=true")
        run.assert_called_once_with("C", "L", "lecture", "pdf", fresh=True)

    def test_pdf_defaults_to_not_fresh(self):
        run = self._post("/courses/C/lectures/L/run/pdf")
        run.assert_called_once_with("C", "L", "lecture", "pdf", fresh=False)

    def test_other_steps_ignore_fresh(self):
        run = self._post("/courses/C/lectures/L/run/transcribe?fresh=true")
        run.assert_called_once_with("C", "L", "lecture", "transcribe", fresh=False)


class TestAutoRemoveApply:
    def test_answers_the_sweeps_counts(self):
        counts = {"removed": 2, "locked": 1, "deferred": 0, "failed": 0}
        with patch.object(
            backend_main.runner, "apply_auto_remove", return_value=counts
        ):
            response = client.post("/auto-remove/apply")
        assert response.status_code == 200
        assert response.json() == counts

    def test_no_data_root_is_a_409(self):
        error = DbClientError("no data root", "data_root_not_configured")
        with patch.object(backend_main.runner, "apply_auto_remove", side_effect=error):
            response = client.post("/auto-remove/apply")
        assert response.status_code == 409
        assert response.json()["code"] == "data_root_not_configured"


class TestRunAssignmentStep:
    def test_unknown_step_is_a_404(self):
        response = client.post("/courses/C/assignments/A/run/nope")
        assert response.status_code == 404
        assert response.json()["code"] == "unknown_step"

    def test_pdf_without_its_markdown_is_a_409(self):
        with (
            patch.object(
                backend_main.db_client,
                "get_assignment",
                return_value={"name": "A", "docs": {"intuition": None}},
            ),
            patch.object(backend_main.runner, "try_run_assignment_step") as run,
        ):
            response = client.post("/courses/C/assignments/A/run/intuition_pdf")
        assert response.status_code == 409
        assert response.json()["code"] == "missing_prerequisite"
        assert response.json()["params"] == {
            "file": "intuition.md",
            "step": "intuition",
        }
        run.assert_not_called()

    def test_a_missing_assignment_is_a_404(self):
        err = DbClientError("gone", "lecture_not_found", course="C", lecture="A")
        with patch.object(backend_main.db_client, "get_assignment", side_effect=err):
            response = client.post("/courses/C/assignments/A/run/solution_pdf")
        assert response.status_code == 404
        assert response.json()["code"] == "lecture_not_found"

    def test_fresh_applies_to_pdf_steps_only(self):
        doc = {"md_mtime": 1, "pdf_mtime": None, "pdf_warning": None}
        with (
            patch.object(
                backend_main.db_client,
                "get_assignment",
                return_value={"docs": {"solution": doc}},
            ),
            patch.object(
                backend_main.runner, "try_run_assignment_step", return_value="started"
            ) as run,
        ):
            assert client.post(
                "/courses/C/assignments/A/run/solution_pdf?fresh=true"
            ).json() == {"status": "started"}
            client.post("/courses/C/assignments/A/run/solution?fresh=true")
        assert run.call_args_list[0].kwargs == {"fresh": True}
        assert run.call_args_list[1].kwargs == {"fresh": False}
