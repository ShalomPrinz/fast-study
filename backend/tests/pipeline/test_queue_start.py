import asyncio
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pipeline import runner

pytestmark = pytest.mark.usefixtures("_clean")


@pytest.fixture
def _clean():
    yield
    runner._queue.clear()
    runner._locks.clear()
    runner._in_flight.clear()
    runner._errors.clear()
    runner._handover = None
    runner._started = None
    runner._runner_status.update(running=False, done=0, total=0, last_error=None)


def _entry(lecture: str, depth: str = "full") -> runner.QueueEntry:
    return runner.QueueEntry("C1", lecture, "lecture", depth)


def _where(status: dict, lecture: str) -> tuple[bool, bool]:
    queued = any(q["lecture"] == lecture for q in status["queue"])
    flying = any(f["lecture"] == lecture for f in status["in_flight"])
    return queued, flying


def _drain(queue, *, fetch, call=None):
    async def default_call(course, lecture, kind, step, **_):
        return {"status": "done"}

    async def go():
        runner._queue[:] = queue
        with (
            patch.object(runner, "_fetch_files", fetch),
            patch.object(runner, "_call_step", call or default_call),
            patch.object(runner.db_client, "notify"),
            patch.object(runner, "auto_remove"),
        ):
            await runner.run_all()

    asyncio.run(go())


def _states(lecture_steps):
    """next_step reads files; map the number of finished steps to an existing-files dict."""
    order = ["video.mp4", "audio.mp3", "transcript.txt", "summary.md", "summary.pdf"]
    names = order + ["drive_url.txt"]
    return {n: {"exists": i < lecture_steps} for i, n in enumerate(names)}


def test_a_starting_lecture_is_never_in_neither_status_list():
    seen: dict[str, list] = {"L1": [], "L2": []}
    done_steps = {"L1": 1, "L2": 1}

    def snap(lecture):
        seen[lecture].append(_where(runner.get_status(), lecture))

    async def fetch(course, lecture, kind):
        snap(lecture)
        await asyncio.sleep(0)  # the await the status refetch lands in
        snap(lecture)
        return _states(done_steps[lecture])

    async def call(course, lecture, kind, step, **_):
        snap(lecture)
        done_steps[lecture] = 6  # every output present afterwards
        return {"status": "done"}

    _drain([_entry("L1"), _entry("L2")], fetch=fetch, call=call)

    for lec, wheres in seen.items():
        assert (False, False) not in wheres, (lec, wheres)
    assert runner._queue == [] and runner._started is None


def test_the_started_head_leaves_the_queue_with_its_first_step():
    at_step = {}

    async def fetch(course, lecture, kind):
        return _states(6 if at_step else 1)

    async def call(course, lecture, kind, step, **_):
        at_step[lecture] = _where(runner.get_status(), lecture)
        return {"status": "done"}

    _drain([_entry("L1")], fetch=fetch, call=call)
    assert at_step["L1"] == (False, True)


def test_the_head_is_listed_in_queue_while_its_files_are_fetched():
    seen = []

    async def fetch(course, lecture, kind):
        if lecture == "L1" and not seen:
            seen.append(runner.get_status()["queue"])
        return _states(6)  # nothing left

    _drain([_entry("L1"), _entry("L2")], fetch=fetch)
    assert [q["lecture"] for q in seen[0]] == ["L1", "L2"]


def test_move_to_front_leaves_a_started_head_first():
    result = {}

    async def fetch(course, lecture, kind):
        if lecture == "L1":
            result["head"] = runner.move_to_front("C1", "L1", "lecture")
            result["moved"] = runner.move_to_front("C1", "L3", "lecture")
            result["order"] = [q["lecture"] for q in runner.get_status()["queue"]]
        return _states(6)

    _drain([_entry("L1"), _entry("L2"), _entry("L3")], fetch=fetch)
    assert result == {
        "head": "not_queued",
        "moved": "moved",
        "order": ["L1", "L3", "L2"],
    }


def test_total_counts_the_started_head_once():
    totals = []

    async def fetch(course, lecture, kind):
        totals.append((runner._runner_status["done"], runner._runner_status["total"]))
        return _states(6)

    _drain([_entry("L1"), _entry("L2")], fetch=fetch)
    assert totals[0] == (0, 2)
    assert runner._runner_status["done"] == 2 and runner._runner_status["total"] == 2


def test_enqueue_still_refuses_the_starting_head():
    seen = []

    async def fetch(course, lecture, kind):
        seen.append(runner.enqueue(_entry("L1")))
        return _states(6)

    _drain([_entry("L1")], fetch=fetch)
    assert seen == [False]


def test_a_run_that_reaches_no_step_leaves_the_queue_clean():
    async def fetch(course, lecture, kind):
        return _states(6)

    _drain([_entry("L1"), _entry("L2")], fetch=fetch)
    assert runner._queue == [] and runner._started is None


def test_a_crashed_run_leaves_the_queue_clean():
    async def fetch(course, lecture, kind):
        raise RuntimeError("db down")

    _drain([_entry("L1")], fetch=fetch)
    assert runner._queue == [] and runner._started is None
    assert runner._runner_status["last_error"]["code"] == "run_crashed"


def test_a_lock_held_lecture_is_skipped_and_leaves_the_queue():
    async def fetch(course, lecture, kind):
        return _states(6)

    async def go():
        runner._queue[:] = [_entry("L1")]
        lock = runner._locks.setdefault(("C1", "L1", "lecture"), asyncio.Lock())
        async with lock:
            with (
                patch.object(runner, "_fetch_files", fetch),
                patch.object(runner.db_client, "notify"),
            ):
                await runner.run_all()

    asyncio.run(go())
    assert runner._queue == [] and runner._started is None


def test_a_run_blocked_before_its_first_step_notifies_after_leaving_the_queue():
    queue_at_notify = []
    before_second = []

    async def fetch(course, lecture, kind):
        if lecture == "L2":
            before_second.extend(queue_at_notify)
        runner._summarize_block = {
            "message": "quota",
            "params": {},
        }  # run_all resets it at start
        return _states(3)  # summarize is next

    async def go():
        runner._queue[:] = [_entry("L1"), _entry("L2")]
        with (
            patch.object(runner, "_fetch_files", fetch),
            patch.object(
                runner.db_client,
                "notify",
                side_effect=lambda: queue_at_notify.append(
                    [q[1] for q in runner._queue]
                ),
            ),
            patch.object(runner, "auto_remove"),
        ):
            await runner.run_all()

    asyncio.run(go())
    assert before_second[-1] == [
        "L2"
    ]  # L1 left, and the page was told, before L2 began
