"""Gemini auto retry for the overview's analyze phase. Reuses the in-memory `db` fixture of
test_runner.py; timers are fired by calling `_fire_retry` directly."""

import asyncio

import pytest
from course import analyze as course_analyze
from course import runner as course_runner
from services.errors import CodedError
from tests.course import test_runner as base
from tests.course.test_runner import COURSE, _course_node, _wait_done

# The module-level state reset and the in-memory database are test_runner's fixtures.
db = base.db
reset_course_runner_state = base.reset_course_runner_state

SLUG = "exam-hints"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for var in ("AUTO_RETRY", "AUTO_RETRY_COUNT", "AUTO_RETRY_MINUTES"):
        monkeypatch.delenv(var, raising=False)
    yield
    course_runner.cancel_all_retries()
    course_runner._attempts.clear()


async def _fired():
    """Fire the waiting retry and settle: the replay task first, then the run it starts."""

    course_runner._fire_retry(COURSE, SLUG)
    await _wait_done()
    return await _wait_done()


def _failing(code="gemini_overloaded", **params):
    def analyze(ext, report, course):
        raise CodedError("x", code, **params)

    return analyze


def _generate():
    return course_runner.try_run_generate(COURSE, _course_node(), [SLUG])


class TestOverviewRetry:
    def test_a_transient_analyze_failure_exposes_a_retry_on_the_extractor(
        self, db, monkeypatch
    ):
        monkeypatch.setattr(course_analyze, "analyze", _failing())

        async def go():
            _generate()
            status = await _wait_done()
            entry = status["extractors"][SLUG]
            assert entry["status"] == "error" and entry["code"] == "gemini_overloaded"
            assert (entry["retry"]["attempt"], entry["retry"]["of"]) == (1, 3)
            assert "at" in entry["retry"]

        asyncio.run(go())

    @pytest.mark.parametrize(
        "code,params",
        [
            ("gemini_quota_exhausted", {"scope": "daily"}),
            ("missing_api_key", {}),
            ("analysis_failed", {"detail": "x"}),
        ],
    )
    def test_permanent_failures_never_schedule(self, db, monkeypatch, code, params):
        monkeypatch.setattr(course_analyze, "analyze", _failing(code, **params))

        async def go():
            _generate()
            status = await _wait_done()
            assert "retry" not in status["extractors"][SLUG]
            assert course_runner._retries == {}

        asyncio.run(go())

    def test_firing_reruns_from_analyze_and_success_clears_the_error(
        self, db, monkeypatch
    ):
        monkeypatch.setattr(course_analyze, "analyze", _failing())

        async def go():
            _generate()
            await _wait_done()
            monkeypatch.setattr(
                course_analyze, "analyze", lambda ext, report, course: "ok"
            )
            status = await _fired()
            assert status["extractors"][SLUG]["status"] == "done"
            assert course_runner._attempts == {} and course_runner._retries == {}

        asyncio.run(go())

    def test_the_count_limit_leaves_the_error(self, db, monkeypatch):
        monkeypatch.setattr(course_analyze, "analyze", _failing())

        async def go():
            _generate()
            await _wait_done()
            for _ in range(3):
                status = await _fired()
            entry = status["extractors"][SLUG]
            assert entry["code"] == "gemini_overloaded" and "retry" not in entry
            assert course_runner._attempts == {}

        asyncio.run(go())

    def test_cancel_keeps_the_error_and_drops_the_timer(self, db, monkeypatch):
        monkeypatch.setattr(course_analyze, "analyze", _failing())

        async def go():
            _generate()
            await _wait_done()
            handle = course_runner._retries[(COURSE, SLUG)]["handle"]
            assert course_runner.cancel_retry(COURSE, SLUG) is True
            assert handle.cancelled()
            entry = course_runner.get_status(COURSE)["extractors"][SLUG]
            assert entry["status"] == "error" and "retry" not in entry
            assert course_runner.cancel_retry(COURSE, SLUG) is False

        asyncio.run(go())

    def test_a_manual_run_supersedes_the_retry(self, db, monkeypatch):
        monkeypatch.setattr(course_analyze, "analyze", _failing())

        async def go():
            _generate()
            await _wait_done()
            handle = course_runner._retries[(COURSE, SLUG)]["handle"]
            monkeypatch.setattr(
                course_analyze, "analyze", lambda ext, report, course: "ok"
            )
            _generate()
            await _wait_done()
            assert handle.cancelled() and course_runner._retries == {}

        asyncio.run(go())

    def test_switching_off_drops_every_retry(self, db, monkeypatch):
        monkeypatch.setattr(course_analyze, "analyze", _failing())

        async def go():
            _generate()
            await _wait_done()
            course_runner.cancel_all_retries()
            assert course_runner._retries == {}
            entry = course_runner.get_status(COURSE)["extractors"][SLUG]
            assert "retry" not in entry

        asyncio.run(go())
