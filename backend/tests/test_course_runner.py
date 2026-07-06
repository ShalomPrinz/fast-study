"""Overview flow tests driving `course/runner.py` directly (no HTTP layer).

The overview run is fire-and-forget: `try_run_generate` schedules the work via
`asyncio.create_task`, so every test body runs inside an inner `async def go()`
executed with `asyncio.run(go())` — same pattern as `tests/test_runner.py`.
db_client and Gemini (`overview.analyze`) are fully mocked — no network, no
database service. The two route-only concerns (CSV parsing, course-not-found
wiring) are covered via the pure `resolve_slugs` / `main._find_course`.

`try_run_generate` runs BOTH phases (extract → analyze) sequentially under one
per-course lock; the in-memory `db` fixture chains them by returning from
`get_overview_file` whatever `put_overview_file` wrote, so a real extract→analyze
handoff is exercised end to end."""

import asyncio
import threading
from types import SimpleNamespace

import pytest

import main
from course import overview as ep
from course import runner as course_runner
from services import db_client
from services.db_client import DbClientError

COURSE = "מבני נתונים"

# Matches Exam Hints ("במבחן") but no student-qa/pitfalls pattern — one run yields
# both a done extractor and skipped ones.
TRANSCRIPT = "משפט פתיחה של השיעור. זה יהיה במבחן בטוח. משפט סיום."


def _tree():
    return [{
        "name": COURSE,
        "lectures": [{"name": "Lecture 1", "files": {"transcript.txt": {"exists": True}}}],
        "recitations": [],
    }]


def _course_node():
    return _tree()[0]


@pytest.fixture(autouse=True)
def reset_course_runner_state():
    course_runner._locks.clear()
    course_runner._status.clear()
    yield
    course_runner._locks.clear()
    course_runner._status.clear()


@pytest.fixture
def db(monkeypatch):
    """Mock every db_client call the overview flow touches; records calls for asserts.

    Extract's writes feed analyze's reads via `overview_store`, so `get_overview_file`
    raises DbClientError exactly when extract wrote no {slug}.txt (skipped extractor)."""
    calls = SimpleNamespace(puts=[], transcript_gets=[], notifies=0, overview_store={})
    monkeypatch.setattr(db_client, "get_tree", lambda: _tree())

    def get_file_bytes(course, lecture, kind, filename):
        calls.transcript_gets.append((course, lecture, kind, filename))
        return TRANSCRIPT.encode("utf-8")

    def put_overview_file(course, filename, data):
        calls.puts.append((course, filename, data.decode("utf-8")))
        calls.overview_store[filename] = data

    def get_overview_file(course, filename):
        if filename not in calls.overview_store:
            raise DbClientError(f"{filename} not found in {course}/overview")
        return calls.overview_store[filename]

    def notify():
        calls.notifies += 1

    monkeypatch.setattr(db_client, "get_file_bytes", get_file_bytes)
    monkeypatch.setattr(db_client, "put_overview_file", put_overview_file)
    monkeypatch.setattr(db_client, "get_overview_file", get_overview_file)
    monkeypatch.setattr(db_client, "notify", notify)
    # Analyze is glue over Gemini — stub it so no network; per-slug prefix keeps asserts readable.
    monkeypatch.setattr(ep, "analyze", lambda ext, report, course: f"ניתוח:{ext.slug}")
    return calls


async def _wait_done(course=COURSE, timeout=5.0):
    """Poll runner status on the running loop until the background run finishes."""
    for _ in range(int(timeout / 0.01)):
        status = course_runner.get_status(course)
        if status["phase"] is not None and not status["running"]:
            return status
        await asyncio.sleep(0.01)
    raise AssertionError("overview run did not finish in time")


class TestGenerateAll:
    def test_runs_extract_then_analyze_for_all_extractors(self, db):
        slugs, err = course_runner.resolve_slugs(None)  # None ⇒ all
        assert err is None

        async def go():
            assert course_runner.try_run_generate(COURSE, _course_node(), slugs) == "started"
            return await _wait_done()

        status = asyncio.run(go())
        # Final phase is analyze — the run ends there, not at extract.
        assert status["phase"] == "analyze"
        assert status["started_at"] is not None
        assert list(status["extractors"]) == [e.slug for e in ep.EXTRACTORS]
        # exam-hints matched → extract wrote its .txt, analyze wrote its -analyzed.md.
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        # No match → extract skipped, so analyze has no .txt to read → skipped too.
        assert status["extractors"]["student-qa"]["status"] == "skipped"
        assert status["extractors"]["pitfalls"]["status"] == "skipped"

    def test_writes_snippet_txt_then_analyzed_md(self, db):
        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            return await _wait_done()

        asyncio.run(go())
        # Order matters: extract's {slug}.txt must land before analyze's {slug}-analyzed.md.
        assert [(f) for _, f, _ in db.puts] == ["exam-hints.txt", "exam-hints-analyzed.md"]
        report = db.puts[0][2]
        assert "Exam Hints" in report and "=== Lecture 1 ===" in report
        assert db.puts[1][2] == "ניתוח:exam-hints"

    def test_notify_fires_per_extractor_both_phases_plus_boundary_and_end(self, db):
        # 3 extractors: extract pings ×3 + phase boundary ×1 + analyze pings ×3 + run end ×1.
        async def go():
            slugs, _ = course_runner.resolve_slugs(None)
            course_runner.try_run_generate(COURSE, _course_node(), slugs)
            await _wait_done()

        asyncio.run(go())
        assert db.notifies == 8


class TestGenerateSubset:
    def test_only_selected_extractor_runs(self, db):
        async def go():
            assert course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"]) == "started"
            return await _wait_done()

        status = asyncio.run(go())
        assert list(status["extractors"]) == ["exam-hints"]
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        assert [f for _, f, _ in db.puts] == ["exam-hints.txt", "exam-hints-analyzed.md"]

    def test_no_match_subset_skips_both_phases(self, db):
        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["student-qa"])
            return await _wait_done()

        status = asyncio.run(go())
        # Extract finds nothing → skipped; analyze then finds no .txt → skipped again.
        assert status["extractors"]["student-qa"]["status"] == "skipped"
        assert db.puts == []
        # extract ping + boundary + analyze ping + run end.
        assert db.notifies == 4

    def test_unknown_extractor_is_error(self):
        # Route glue returns {"status": "error", "message": err} from this pair.
        slugs, err = course_runner.resolve_slugs("nope")
        assert err is not None and "nope" in err

    def test_unknown_course_is_error(self, db):
        async def go():
            return await main._find_course("אין-כזה")

        node, err = asyncio.run(go())
        assert node is None
        assert err == {"status": "error", "message": "course not found: אין-כזה"}


class TestPhaseTransitions:
    def test_phase_starts_extract_before_switching_to_analyze(self, db, monkeypatch):
        release = threading.Event()

        def blocking_get_file_bytes(course, lecture, kind, filename):
            release.wait(timeout=5)
            return TRANSCRIPT.encode("utf-8")

        monkeypatch.setattr(db_client, "get_file_bytes", blocking_get_file_bytes)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            try:
                # Blocked inside extract → phase is "extract" and running stays True.
                st = course_runner.get_status(COURSE)
                for _ in range(500):
                    st = course_runner.get_status(COURSE)
                    if course_runner._locks[COURSE].locked() and st["phase"] == "extract":
                        break
                    await asyncio.sleep(0.01)
                assert st["phase"] == "extract" and st["running"] is True
            finally:
                release.set()
            return await _wait_done()

        status = asyncio.run(go())
        assert status["phase"] == "analyze"

    def test_running_stays_true_through_analyze(self, db, monkeypatch):
        release = threading.Event()

        def slow_analyze(ext, report, course):
            release.wait(timeout=5)
            return "ניתוח"

        monkeypatch.setattr(ep, "analyze", slow_analyze)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            try:
                # No false "done" flicker between phases: while analyze blocks, the run is
                # still marked running with phase "analyze" and the extractor "running".
                st = course_runner.get_status(COURSE)
                for _ in range(500):
                    st = course_runner.get_status(COURSE)
                    if st["phase"] == "analyze" and st["extractors"]["exam-hints"]["status"] == "running":
                        break
                    await asyncio.sleep(0.01)
                assert st["running"] is True
                assert st["phase"] == "analyze"
                assert st["extractors"]["exam-hints"]["status"] == "running"
            finally:
                release.set()
            await _wait_done()

        asyncio.run(go())


class TestErrors:
    def test_gemini_failure_marks_error(self, db, monkeypatch):
        def boom(ext, report, course):
            raise RuntimeError("gemini exploded")

        monkeypatch.setattr(ep, "analyze", boom)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            return await _wait_done()

        status = asyncio.run(go())
        # Extract succeeded (wrote .txt); analyze is what blew up.
        assert status["extractors"]["exam-hints"] == {"status": "error", "message": "gemini exploded"}
        assert [f for _, f, _ in db.puts] == ["exam-hints.txt"]

    def test_one_extractor_error_does_not_abort_others(self, db, monkeypatch):
        # exam-hints matches; force its analyze to fail — pitfalls (skipped) must still be reached.
        def selective(ext, report, course):
            if ext.slug == "exam-hints":
                raise RuntimeError("boom")
            return "ניתוח"

        monkeypatch.setattr(ep, "analyze", selective)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints", "pitfalls"])
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"]["status"] == "error"
        assert status["extractors"]["pitfalls"]["status"] == "skipped"  # no snippets → no .txt


class TestSharedLock:
    def test_busy_while_running_and_status_not_clobbered(self, db, monkeypatch):
        release = threading.Event()

        def blocking_get_file_bytes(course, lecture, kind, filename):
            release.wait(timeout=5)
            return TRANSCRIPT.encode("utf-8")

        monkeypatch.setattr(db_client, "get_file_bytes", blocking_get_file_bytes)

        async def go():
            assert course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"]) == "started"
            try:
                for _ in range(500):  # wait until the run actually holds the course lock
                    if course_runner._locks[COURSE].locked():
                        break
                    await asyncio.sleep(0.01)
                assert course_runner._locks[COURSE].locked()

                # Same course while a run is in flight → busy.
                assert course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"]) == "busy"

                # A busy trigger must not clobber the in-flight run's status.
                status = course_runner.get_status(COURSE)
                assert status["running"] is True and status["phase"] == "extract"
            finally:
                release.set()
            await _wait_done()

            # Lock released → a fresh generate starts normally on the same loop.
            assert course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"]) == "started"
            await _wait_done()

        asyncio.run(go())


class TestStatusAndListing:
    def test_never_run_course_shape(self):
        assert course_runner.get_status("קורס-חדש") == {
            "running": False, "phase": None, "started_at": None, "extractors": {},
        }

    def test_extractors_listing_in_declaration_order(self):
        listing = [{"slug": e.slug, "title": e.title} for e in ep.EXTRACTORS]
        assert [x["slug"] for x in listing] == [
            "exam-hints", "student-qa", "pitfalls",
        ]
        assert [x["title"] for x in listing] == [
            "Exam Hints", "Student QA", "Pitfalls",
        ]
