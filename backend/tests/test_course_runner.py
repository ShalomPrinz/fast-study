"""Overview flow tests driving `course/runner.py` directly (no HTTP layer).

The overview run is fire-and-forget: `try_run_generate` schedules the work via
`asyncio.create_task`, so every test body runs inside an inner `async def go()`
executed with `asyncio.run(go())` — same pattern as `tests/test_runner.py`.
db_client and Gemini (`analyze.analyze`) are fully mocked — no network, no
database service. The two route-only concerns (CSV parsing, course-not-found
wiring) are covered via the pure `resolve_slugs` / `main._find_course`.

`try_run_generate` runs all THREE phases (extract → analyze → to_pdf) sequentially
under one per-course lock; the in-memory `db` fixture chains them by returning from
`get_overview_file` whatever `put_overview_file` wrote, so a real extract→analyze→
to_pdf handoff is exercised end to end. `convert_to_pdf` is stubbed (no pandoc)."""

import asyncio
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

import main
from course import analyze as course_analyze
from course import collect as course_collect
from course import extract as course_extract
from course import overview as ep
from course import runner as course_runner
from course import to_pdf as course_to_pdf
from services import db_client
from services.db_client import DbClientError

COURSE = "מבני נתונים"

# Matches Exam Hints ("במבחן") but no student-qa/pitfalls pattern — one run yields
# both a done extractor and skipped ones.
TRANSCRIPT = "משפט פתיחה של השיעור. זה יהיה במבחן בטוח. משפט סיום."

# The three pattern extractors (topics is the immediate one, filtered out of extract/analyze).
PATTERN_SLUGS = ["exam-hints", "student-qa", "pitfalls"]

SUMMARY = "# ‏כותרת\n\n## ‏נושא ראשון\n\n- פריט אחד\n"


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

    def list_overview_files(course):
        # skip_existing snapshots this once at run start; reflects whatever was seeded.
        return [{"name": name, "size": len(data), "mtime": 0}
                for name, data in calls.overview_store.items()]

    def notify():
        calls.notifies += 1

    def get_summary(course, lecture, kind):
        calls.summary_gets.append((course, lecture, kind))
        return SUMMARY

    calls.summary_gets = []
    monkeypatch.setattr(db_client, "get_summary", get_summary)
    monkeypatch.setattr(db_client, "get_file_bytes", get_file_bytes)
    monkeypatch.setattr(db_client, "put_overview_file", put_overview_file)
    monkeypatch.setattr(db_client, "get_overview_file", get_overview_file)
    monkeypatch.setattr(db_client, "list_overview_files", list_overview_files)
    monkeypatch.setattr(db_client, "notify", notify)
    # Analyze is glue over Gemini — stub it so no network; per-slug prefix keeps asserts readable.
    monkeypatch.setattr(course_analyze, "analyze", lambda ext, report, course: f"ניתוח:{ext.slug}")

    # to_pdf reuses pipeline.convert_to_pdf; stub it (no pandoc/XeLaTeX) — it drops a .pdf
    # beside the input md and returns that path, which the phase reads back and uploads.
    def fake_convert(md_path):
        out = Path(md_path).with_suffix(".pdf")
        out.write_bytes(b"%PDF-1.4 stub")
        return str(out)

    monkeypatch.setattr(course_to_pdf, "convert_to_pdf", fake_convert)
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
    def test_runs_extract_then_analyze_then_to_pdf_for_all_extractors(self, db):
        slugs, err = course_runner.resolve_slugs(None)  # None ⇒ all
        assert err is None

        async def go():
            assert course_runner.try_run_generate(COURSE, _course_node(), slugs) == "started"
            return await _wait_done()

        status = asyncio.run(go())
        # Final phase is to_pdf — the run ends there, not at extract/analyze/topics.
        assert status["phase"] == "to_pdf"
        assert status["started_at"] is not None
        assert list(status["extractors"]) == [e.slug for e in ep.EXTRACTORS]
        # exam-hints matched → extract .txt → analyze .md → to_pdf .pdf, all done.
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        # No match → extract skipped, so nothing downstream to analyze/render → skipped throughout.
        assert status["extractors"]["student-qa"]["status"] == "skipped"
        assert status["extractors"]["pitfalls"]["status"] == "skipped"
        # topics has no summaries in this tree → collect skips, then to_pdf finds no topics.md → skipped.
        assert status["extractors"]["topics"]["status"] == "skipped"

    def test_writes_txt_then_md_then_pdf(self, db):
        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            return await _wait_done()

        asyncio.run(go())
        # Order matters: extract's .txt, then analyze's .md, then to_pdf's .pdf.
        assert [f for _, f, _ in db.puts] == [
            "exam-hints.txt", "exam-hints.md", "exam-hints.pdf",
        ]
        report = db.puts[0][2]
        assert "Exam Hints" in report and "=== Lecture 1 ===" in report
        assert db.puts[1][2] == "ניתוח:exam-hints"
        # The PDF the to_pdf phase uploaded is exactly what convert_to_pdf produced from the .md.
        assert db.overview_store["exam-hints.pdf"] == b"%PDF-1.4 stub"

    def test_notify_fires_per_extractor_all_phases_plus_boundaries_and_end(self, db):
        # All 4 extractors (3 pattern + topics). This tree has transcripts but no summaries, so:
        #   extract  : 3 pattern extractors    → 3 (first active phase, no boundary ping)
        #   analyze  : boundary + 3 pattern    → 4
        #   topics   : boundary + 1 collect    → 2
        #   to_pdf   : boundary + 4 extractors → 5
        #   run end                            → 1
        async def go():
            slugs, _ = course_runner.resolve_slugs(None)
            course_runner.try_run_generate(COURSE, _course_node(), slugs)
            await _wait_done()

        asyncio.run(go())
        assert db.notifies == 15


class TestGenerateSubset:
    def test_only_selected_extractor_runs(self, db):
        async def go():
            assert course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"]) == "started"
            return await _wait_done()

        status = asyncio.run(go())
        assert list(status["extractors"]) == ["exam-hints"]
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        assert [f for _, f, _ in db.puts] == [
            "exam-hints.txt", "exam-hints.md", "exam-hints.pdf",
        ]

    def test_no_match_subset_skips_all_phases(self, db):
        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["student-qa"])
            return await _wait_done()

        status = asyncio.run(go())
        # Extract finds nothing → skipped; analyze finds no .txt, to_pdf finds no .md → skipped throughout.
        assert status["extractors"]["student-qa"]["status"] == "skipped"
        assert db.puts == []
        # 1 ping per phase (×3) + 2 boundaries + run end.
        assert db.notifies == 6

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
        assert status["phase"] == "to_pdf"

    def test_running_stays_true_through_analyze(self, db, monkeypatch):
        release = threading.Event()

        def slow_analyze(ext, report, course):
            release.wait(timeout=5)
            return "ניתוח"

        monkeypatch.setattr(course_analyze, "analyze", slow_analyze)

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

        monkeypatch.setattr(course_analyze, "analyze", boom)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            return await _wait_done()

        status = asyncio.run(go())
        # Extract wrote .txt; analyze blew up → the error survives to_pdf (which skips an
        # already-errored extractor) instead of being masked as a downstream "skipped".
        assert status["extractors"]["exam-hints"] == {"status": "error", "message": "gemini exploded"}
        assert [f for _, f, _ in db.puts] == ["exam-hints.txt"]

    def test_one_extractor_error_does_not_abort_others(self, db, monkeypatch):
        # exam-hints matches; force its analyze to fail — pitfalls (skipped) must still be reached.
        def selective(ext, report, course):
            if ext.slug == "exam-hints":
                raise RuntimeError("boom")
            return "ניתוח"

        monkeypatch.setattr(course_analyze, "analyze", selective)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints", "pitfalls"])
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"]["status"] == "error"
        assert status["extractors"]["pitfalls"]["status"] == "skipped"  # no snippets → no .txt


class TestToPdfPhase:
    # A transcript matching TWO extractors (exam-hints "במבחן" + pitfalls "שימו לב"), so both
    # reach the to_pdf phase with an analyzed .md and PDF error isolation can be exercised.
    TWO_MATCH = "משפט פתיחה. זה יהיה במבחן בטוח. שימו לב לזה. משפט סיום."

    def test_renders_pdf_from_analyzed_md(self, db):
        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            return await _wait_done()

        status = asyncio.run(go())
        assert status["phase"] == "to_pdf"
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        # The pdf's input was the analyzed .md written a phase earlier (chained via overview_store).
        assert "exam-hints.pdf" in db.overview_store
        assert db.overview_store["exam-hints.pdf"] == b"%PDF-1.4 stub"

    def test_missing_analyzed_md_skips(self, db):
        # student-qa never matches → no .txt, no .md → to_pdf has nothing to render.
        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["student-qa"])
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["student-qa"] == {
            "status": "skipped", "message": "no analyzed markdown — run analyze first",
        }

    def test_pdf_failure_marks_error(self, db, monkeypatch):
        def boom(md_path):
            raise RuntimeError("pandoc boom")

        monkeypatch.setattr(course_to_pdf, "convert_to_pdf", boom)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"])
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"] == {"status": "error", "message": "pandoc boom"}
        # analyze still wrote the .md; only the .pdf upload was skipped.
        assert [f for _, f, _ in db.puts] == ["exam-hints.txt", "exam-hints.md"]

    def test_one_pdf_failure_does_not_abort_others(self, db, monkeypatch):
        monkeypatch.setattr(db_client, "get_file_bytes",
                            lambda *a: self.TWO_MATCH.encode("utf-8"))

        def selective(md_path):
            if "exam-hints" in md_path:
                raise RuntimeError("pandoc boom")
            out = Path(md_path).with_suffix(".pdf")
            out.write_bytes(b"%PDF-1.4 stub")
            return str(out)

        monkeypatch.setattr(course_to_pdf, "convert_to_pdf", selective)

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints", "pitfalls"])
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"]["status"] == "error"
        assert status["extractors"]["pitfalls"] == {"status": "done"}
        # exam-hints failed to render → no pdf; pitfalls rendered → pdf uploaded.
        assert "exam-hints.pdf" not in db.overview_store
        assert db.overview_store["pitfalls.pdf"] == b"%PDF-1.4 stub"


class TestFromPhase:
    """A run may START from a chosen phase and run through to_pdf, leaving earlier-phase
    files untouched (kept, never re-run). from_phase seeds the run's initial phase."""

    def _seed(self, db, filename, data):
        """Pre-populate overview_store as if an earlier phase already produced its file."""
        db.overview_store[filename] = data

    def test_from_analyze_runs_analyze_and_to_pdf_only_txt_untouched(self, db):
        # Pretend extract already wrote exam-hints.txt; starting from analyze must not re-run it.
        self._seed(db, "exam-hints.txt", b"report")

        async def go():
            assert course_runner.try_run_generate(
                COURSE, _course_node(), ["exam-hints"], "analyze") == "started"
            return await _wait_done()

        status = asyncio.run(go())
        assert status["phase"] == "to_pdf"
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        # Extract skipped → only analyze's .md and to_pdf's .pdf written; the seeded .txt is kept as-is.
        assert [f for _, f, _ in db.puts] == ["exam-hints.md", "exam-hints.pdf"]
        assert db.overview_store["exam-hints.txt"] == b"report"

    def test_from_to_pdf_runs_to_pdf_only_txt_and_md_untouched(self, db):
        # Pretend extract + analyze already ran; starting from to_pdf must not re-run either.
        self._seed(db, "exam-hints.txt", b"report")
        self._seed(db, "exam-hints.md", b"# analyzed")

        async def go():
            assert course_runner.try_run_generate(
                COURSE, _course_node(), ["exam-hints"], "to_pdf") == "started"
            return await _wait_done()

        status = asyncio.run(go())
        assert status["phase"] == "to_pdf"
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        # Only the .pdf is written; the seeded .txt and .md are kept untouched.
        assert [f for _, f, _ in db.puts] == ["exam-hints.pdf"]
        assert db.overview_store["exam-hints.txt"] == b"report"
        assert db.overview_store["exam-hints.md"] == b"# analyzed"

    def test_from_analyze_seeds_initial_phase_analyze(self, db):
        # try_run_generate installs status synchronously; the first poll must see phase "analyze".
        self._seed(db, "exam-hints.txt", b"report")

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"], "analyze")
            # Status is seeded before the background task runs → phase is the start phase.
            phase = course_runner.get_status(COURSE)["phase"]
            await _wait_done()
            return phase

        assert asyncio.run(go()) == "analyze"

    def test_bogus_from_phase_degrades_to_default_without_raising(self, db):
        # An invalid from_phase must not raise (would be an unhandled 500 in try_run_generate);
        # the runner defends its boundary and behaves as if starting from the default (extract).
        async def go():
            # Synchronous _new_run seeds the initial phase — bogus must not blow up here.
            result = course_runner.try_run_generate(COURSE, _course_node(), ["exam-hints"], "bogus")
            seeded = course_runner.get_status(COURSE)["phase"]
            status = await _wait_done()
            return result, seeded, status

        result, seeded, status = asyncio.run(go())
        assert result == "started"
        # Default start (extract) → exam-hints participates from extract, so extract is seeded, not "bogus".
        assert seeded == "extract"
        assert status["phase"] == "to_pdf"
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        # Started from the default → extract wrote .txt, analyze .md, to_pdf .pdf (all phases ran).
        assert [f for _, f, _ in db.puts] == ["exam-hints.txt", "exam-hints.md", "exam-hints.pdf"]

    def test_start_index_helper_unknown_is_zero(self):
        assert course_runner._start_index("bogus") == 0
        assert course_runner._start_index("analyze") == course_runner.PHASE_ORDER.index("analyze")


class TestSkipExisting:
    """`skip_existing=true` is a "continue": each phase output already on disk at run start is KEPT
    (its extractor not re-run, marked skipped/"already generated"); missing outputs generate normally.
    The snapshot is taken ONCE at run start via db_client.list_overview_files."""

    def _seed(self, db, filename, data):
        db.overview_store[filename] = data

    def test_fully_done_slug_untouched_workers_not_called(self, db, monkeypatch):
        # A slug with .txt+.md+.pdf already present → every phase keeps it; no worker fires for it.
        self._seed(db, "exam-hints.txt", b"report")
        self._seed(db, "exam-hints.md", b"# analyzed")
        self._seed(db, "exam-hints.pdf", b"%PDF old")
        monkeypatch.setattr(course_extract, "fetch_sources",
                            lambda *a: pytest.fail("extract worker must not run for a fully-done slug"))
        monkeypatch.setattr(course_analyze, "analyze",
                            lambda *a: pytest.fail("analyze worker must not run for a fully-done slug"))
        monkeypatch.setattr(course_to_pdf, "convert_to_pdf",
                            lambda *a: pytest.fail("to_pdf worker must not run for a fully-done slug"))

        async def go():
            assert course_runner.try_run_generate(
                COURSE, _course_node(), ["exam-hints"], skip_existing=True) == "started"
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"] == {"status": "skipped", "message": "already generated"}
        assert db.puts == []  # nothing overwritten
        # Seeded files are byte-for-byte untouched.
        assert db.overview_store["exam-hints.txt"] == b"report"
        assert db.overview_store["exam-hints.md"] == b"# analyzed"
        assert db.overview_store["exam-hints.pdf"] == b"%PDF old"

    def test_partial_slug_continues_extract_kept_analyze_and_to_pdf_run(self, db):
        # Only .txt present → extract kept, analyze + to_pdf run (the "continue" case).
        self._seed(db, "exam-hints.txt", b"report")

        async def go():
            course_runner.try_run_generate(
                COURSE, _course_node(), ["exam-hints"], skip_existing=True)
            return await _wait_done()

        status = asyncio.run(go())
        # Final status reflects the LAST phase (to_pdf ran) → done, not the earlier "kept" skip.
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        assert [f for _, f, _ in db.puts] == ["exam-hints.md", "exam-hints.pdf"]
        assert db.overview_store["exam-hints.txt"] == b"report"  # kept, not rewritten

    def test_not_started_slug_runs_fully(self, db):
        # No outputs present → skip_existing keeps nothing; every phase generates.
        async def go():
            course_runner.try_run_generate(
                COURSE, _course_node(), ["exam-hints"], skip_existing=True)
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        assert [f for _, f, _ in db.puts] == ["exam-hints.txt", "exam-hints.md", "exam-hints.pdf"]

    def test_skip_existing_false_still_overwrites_everything(self, db):
        # Regression: default behavior must overwrite present outputs (the ↺ re-generate flows rely on it).
        self._seed(db, "exam-hints.txt", b"OLD txt")
        self._seed(db, "exam-hints.md", b"OLD md")
        self._seed(db, "exam-hints.pdf", b"OLD pdf")

        async def go():
            course_runner.try_run_generate(
                COURSE, _course_node(), ["exam-hints"], skip_existing=False)
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"] == {"status": "done"}
        assert [f for _, f, _ in db.puts] == ["exam-hints.txt", "exam-hints.md", "exam-hints.pdf"]
        # Every output was regenerated, not left as the seeded sentinel.
        assert db.overview_store["exam-hints.txt"] != b"OLD txt"
        assert db.overview_store["exam-hints.md"] != b"OLD md"
        assert db.overview_store["exam-hints.pdf"] != b"OLD pdf"

    def test_kept_extractor_does_not_block_or_spuriously_skip_later_phase(self, db):
        # .txt+.md present, .pdf missing → extract AND analyze kept, but to_pdf they still need MUST run.
        # A kept extractor stays a participant (not dropped, not treated as error), so to_pdf isn't skipped.
        self._seed(db, "exam-hints.txt", b"report")
        self._seed(db, "exam-hints.md", b"# analyzed")

        async def go():
            course_runner.try_run_generate(
                COURSE, _course_node(), ["exam-hints"], skip_existing=True)
            return await _wait_done()

        status = asyncio.run(go())
        assert status["extractors"]["exam-hints"] == {"status": "done"}  # to_pdf ran, not skipped
        assert [f for _, f, _ in db.puts] == ["exam-hints.pdf"]
        assert db.overview_store["exam-hints.pdf"] == b"%PDF-1.4 stub"
        assert db.overview_store["exam-hints.txt"] == b"report"     # kept
        assert db.overview_store["exam-hints.md"] == b"# analyzed"  # kept


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


class TestPhaseFiltering:
    """The immediate `topics` extractor declares only ("topics", "to_pdf"); the three pattern
    extractors declare ("extract", "analyze", "to_pdf"). A phase runs only its participants,
    and a phase with none is skipped entirely (no fetch, no notify, no advance)."""

    def _node_with_summary(self):
        return {
            "name": COURSE,
            "lectures": [{"name": "Lecture 1", "files": {
                "transcript.txt": {"exists": True}, "summary.md": {"exists": True}}}],
            "recitations": [],
        }

    def test_topics_only_run_never_enters_extract_or_analyze(self, db, monkeypatch):
        # A Topics-only run must not fetch transcripts: extract/analyze have zero participants.
        monkeypatch.setattr(course_extract, "fetch_sources",
                            lambda *a: pytest.fail("extract phase must be skipped for topics-only run"))

        async def go():
            course_runner.try_run_generate(COURSE, self._node_with_summary(), ["topics"])
            return await _wait_done()

        status = asyncio.run(go())
        assert status["phase"] == "to_pdf"
        assert status["extractors"]["topics"] == {"status": "done"}
        # collect wrote topics.md, to_pdf rendered topics.pdf — nothing else.
        assert [f for _, f, _ in db.puts] == ["topics.md", "topics.pdf"]
        assert db.transcript_gets == []  # never touched a transcript

    def test_topics_only_notify_cadence_skips_empty_phases(self, db):
        # No pings for the empty extract/analyze phases:
        #   topics ×1 (first active, no boundary) + boundary+to_pdf ×1 (=2) + run end = 4.
        async def go():
            course_runner.try_run_generate(COURSE, self._node_with_summary(), ["topics"])
            await _wait_done()

        asyncio.run(go())
        assert db.notifies == 4

    def test_pattern_only_run_never_enters_topics(self, db, monkeypatch):
        monkeypatch.setattr(course_collect, "run_collect",
                            lambda *a: pytest.fail("topics phase must be skipped for a pattern-only run"))

        async def go():
            course_runner.try_run_generate(COURSE, _course_node(), PATTERN_SLUGS)
            return await _wait_done()

        status = asyncio.run(go())
        assert status["phase"] == "to_pdf"
        assert "topics" not in status["extractors"]

    def test_error_isolation_holds_across_new_phase_list(self, db, monkeypatch):
        # exam-hints (pattern) errors in analyze; topics (immediate) still runs its own phases.
        def boom(ext, report, course):
            raise RuntimeError("gemini boom")

        monkeypatch.setattr(course_analyze, "analyze", boom)

        async def go():
            course_runner.try_run_generate(
                COURSE, self._node_with_summary(), ["exam-hints", "topics"])
            return await _wait_done()

        status = asyncio.run(go())
        # exam-hints error survives to the end (not masked as a downstream skip).
        assert status["extractors"]["exam-hints"] == {"status": "error", "message": "gemini boom"}
        # topics is unaffected by the pattern extractor's failure.
        assert status["extractors"]["topics"] == {"status": "done"}
        assert "topics.pdf" in db.overview_store
        assert "exam-hints.pdf" not in db.overview_store


class TestStatusAndListing:
    def test_never_run_course_shape(self):
        assert course_runner.get_status("קורס-חדש") == {
            "running": False, "phase": None, "started_at": None, "extractors": {},
        }

    def test_extractors_listing_in_declaration_order(self):
        listing = main.overview_extractors()["extractors"]
        assert [x["slug"] for x in listing] == [
            "exam-hints", "student-qa", "pitfalls", "topics",
        ]
        assert [x["title"] for x in listing] == [
            "Exam Hints", "Student QA", "Pitfalls", "Topics",
        ]

    def test_extractors_listing_includes_phases(self):
        by_slug = {x["slug"]: x for x in main.overview_extractors()["extractors"]}
        # Pattern extractor → the three-phase pipeline; topics (immediate) → collect then render.
        assert by_slug["exam-hints"]["phases"] == ["extract", "analyze", "to_pdf"]
        assert by_slug["topics"]["phases"] == ["topics", "to_pdf"]
        # phases is a plain JSON list, not the ClassVar tuple.
        assert isinstance(by_slug["topics"]["phases"], list)


class TestPhaseWorkerSeam:
    """The runner↔worker seam: each worker returns a "skipped"/"done" status dict (which the
    runner folds in via entry_status.update) and RAISES on failure (so the runner marks "error").
    Workers must not touch run-level state (`running`, notify) — only the runner owns that."""

    EXAM = ep.EXTRACTORS_BY_SLUG["exam-hints"]

    def test_extract_skips_when_no_snippets(self, monkeypatch):
        monkeypatch.setattr(db_client, "put_overview_file",
                            lambda *a: pytest.fail("must not write when nothing matched"))
        # A source with no matching sentence yields no report → skipped, not done.
        result = course_extract.run_extractor(COURSE, self.EXAM, [("Lecture 1", "משפט רגיל.")])
        assert result == {"status": "skipped", "message": "no snippets found"}

    def test_extract_done_writes_txt(self, monkeypatch):
        puts = []
        monkeypatch.setattr(db_client, "put_overview_file",
                            lambda c, f, d: puts.append((c, f, d.decode("utf-8"))))
        result = course_extract.run_extractor(COURSE, self.EXAM, [("Lecture 1", TRANSCRIPT)])
        assert result == {"status": "done"}
        assert [f for _, f, _ in puts] == ["exam-hints.txt"]

    def test_analyze_skips_when_no_txt(self, monkeypatch):
        def missing(course, filename):
            raise DbClientError("nope")
        monkeypatch.setattr(db_client, "get_overview_file", missing)
        result = course_analyze.run_analyze(COURSE, self.EXAM)
        assert result == {"status": "skipped", "message": "no snippets file — run extract first"}

    def test_analyze_raises_on_empty_gemini(self, monkeypatch):
        monkeypatch.setattr(db_client, "get_overview_file", lambda c, f: b"report")
        monkeypatch.setattr(course_analyze, "analyze", lambda ext, report, course: "")
        with pytest.raises(RuntimeError, match="Gemini returned no text"):
            course_analyze.run_analyze(COURSE, self.EXAM)

    def test_analyze_done_writes_md(self, monkeypatch):
        puts = []
        monkeypatch.setattr(db_client, "get_overview_file", lambda c, f: b"report")
        monkeypatch.setattr(course_analyze, "analyze", lambda ext, report, course: "ניתוח")
        monkeypatch.setattr(db_client, "put_overview_file",
                            lambda c, f, d: puts.append(f))
        assert course_analyze.run_analyze(COURSE, self.EXAM) == {"status": "done"}
        assert puts == ["exam-hints.md"]

    def test_to_pdf_skips_when_no_md(self, monkeypatch):
        def missing(course, filename):
            raise DbClientError("nope")
        monkeypatch.setattr(db_client, "get_overview_file", missing)
        result = course_to_pdf.run_to_pdf(COURSE, "exam-hints")
        assert result == {"status": "skipped", "message": "no analyzed markdown — run analyze first"}

    def test_to_pdf_done_writes_pdf(self, monkeypatch):
        puts = {}
        monkeypatch.setattr(db_client, "get_overview_file", lambda c, f: b"# md")
        monkeypatch.setattr(db_client, "put_overview_file",
                            lambda c, f, d: puts.__setitem__(f, d))

        def fake_convert(md_path):
            out = Path(md_path).with_suffix(".pdf")
            out.write_bytes(b"%PDF-1.4 stub")
            return str(out)

        monkeypatch.setattr(course_to_pdf, "convert_to_pdf", fake_convert)
        assert course_to_pdf.run_to_pdf(COURSE, "exam-hints") == {"status": "done"}
        assert puts["exam-hints.pdf"] == b"%PDF-1.4 stub"
