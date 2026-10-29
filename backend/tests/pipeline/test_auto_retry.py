"""Gemini auto retry in the lecture runner: scheduling, firing, limits, replay, cancel and supersede.
Timers are armed for real (delay 10 min) and fired by calling `_fire_retry` directly."""

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from pipeline import runner

C, L = "C1", "L1"
SKEY = runner._skey(C, L, "lecture")
OVERLOADED = {
    "status": "error",
    "message": "busy",
    "code": "gemini_overloaded",
    "params": {"model": "m"},
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for var in ("AUTO_RETRY", "AUTO_RETRY_COUNT", "AUTO_RETRY_MINUTES"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(runner.db_client, "notify", lambda: None)
    yield
    runner.cancel_all_retries()
    for state in (runner._errors, runner._attempts, runner._in_flight, runner._retries):
        state.clear()
    runner._queue.clear()
    runner._summarize_block = None


def _fail(result=OVERLOADED, calls=None):
    async def fake_call(course, lecture, kind, step, **_opts):
        if calls is not None:
            calls.append(step)
        return result

    return patch.object(runner, "_call_step", fake_call)


def _quota(scope):
    return {
        "status": "error",
        "message": "q",
        "code": "gemini_quota_exhausted",
        "params": {"scope": scope},
    }


async def _drain():
    pending = asyncio.all_tasks() - {asyncio.current_task()}
    if pending:
        await asyncio.gather(*pending)


class TestScheduling:
    def test_a_transient_failure_arms_a_timer_and_exposes_the_retry(self):
        async def go():
            with _fail():
                await runner.run_step(C, L, "lecture", "summarize")
            retry = runner.get_status()["errors"][SKEY]["retry"]
            assert (retry["attempt"], retry["of"]) == (1, 3)
            at = datetime.fromisoformat(retry["at"])
            assert 590 < (at - datetime.now(timezone.utc)).total_seconds() <= 600
            assert SKEY not in runner._in_flight

        asyncio.run(go())

    @pytest.mark.parametrize("scope", ["per_minute"])
    def test_a_per_minute_quota_retries(self, scope):
        async def go():
            with _fail(_quota(scope)):
                await runner.run_step(C, L, "lecture", "summarize")
            assert "retry" in runner._errors[SKEY]

        asyncio.run(go())

    @pytest.mark.parametrize(
        "result",
        [
            _quota("daily"),
            {"status": "error", "message": "k", "code": "missing_api_key"},
            {"status": "error", "message": "k", "code": "api_key_rejected"},
            {"status": "error", "message": "k", "code": "material_too_large"},
            {"status": "error", "message": "k", "code": "summarization_failed"},
            {"status": "error", "message": "k"},
        ],
    )
    def test_a_permanent_failure_or_daily_quota_never_schedules(self, result):
        async def go():
            with _fail(result):
                await runner.run_step(C, L, "lecture", "summarize")
            assert SKEY in runner._errors
            assert "retry" not in runner._errors[SKEY]
            assert runner._retries == {}

        asyncio.run(go())

    def test_only_gemini_steps_retry(self):
        async def go():
            with _fail():
                await runner.run_step(C, L, "lecture", "transcribe")
            assert runner._retries == {}

        asyncio.run(go())

    def test_the_switch_off_schedules_nothing(self, monkeypatch):
        monkeypatch.setenv("AUTO_RETRY", "false")

        async def go():
            with _fail():
                await runner.run_step(C, L, "lecture", "summarize")
            assert runner._retries == {}

        asyncio.run(go())

    def test_the_configured_count_and_delay_apply_to_the_next_schedule_only(
        self, monkeypatch
    ):
        async def go():
            with _fail():
                await runner.run_step(C, L, "lecture", "summarize")
            monkeypatch.setenv("AUTO_RETRY_COUNT", "5")
            monkeypatch.setenv("AUTO_RETRY_MINUTES", "1")
            assert runner._errors[SKEY]["retry"]["of"] == 3
            runner._fire_retry(SKEY)
            await _drain()
            retry = runner._errors[SKEY]["retry"]
            assert (retry["attempt"], retry["of"]) == (2, 5)
            at = datetime.fromisoformat(retry["at"])
            assert (at - datetime.now(timezone.utc)).total_seconds() <= 60

        with _fail():
            asyncio.run(go())


class TestFiring:
    def test_a_lone_step_retry_reruns_only_that_step_and_success_clears_everything(
        self,
    ):
        async def go():
            calls = []
            with _fail(calls=calls):
                await runner.run_step(C, L, "lecture", "summarize")
            with _fail({"status": "done"}, calls):
                runner._fire_retry(SKEY)
                assert "retry" not in runner._errors[SKEY]
                await _drain()
            assert calls == ["summarize", "summarize"]
            assert SKEY not in runner._errors
            assert runner._attempts == {} and runner._retries == {}

        asyncio.run(go())

    def test_the_count_limit_leaves_the_error_as_today(self):
        async def go():
            calls = []
            with _fail(calls=calls):
                await runner.run_step(C, L, "lecture", "summarize")
                seen = [runner._errors[SKEY]["retry"]["attempt"]]
                for _ in range(2):
                    runner._fire_retry(SKEY)
                    await _drain()
                    seen.append(runner._errors[SKEY]["retry"]["attempt"])
                runner._fire_retry(SKEY)
                await _drain()
            assert seen == [1, 2, 3]
            assert len(calls) == 4  # the original plus 3 retries
            assert runner._errors[SKEY]["code"] == "gemini_overloaded"
            assert "retry" not in runner._errors[SKEY]
            assert runner._retries == {} and runner._attempts == {}

        asyncio.run(go())

    def test_a_pipeline_retry_requeues_the_lecture_at_full_depth(self):
        states = [
            {
                "video.mp4": {"exists": True},
                "audio.mp3": {"exists": True},
                "transcript.txt": {"exists": True},
            }
        ]

        async def fake_fetch(*_a):
            return states[0]

        async def go():
            with patch.object(runner, "_fetch_files", fake_fetch), _fail():
                await runner.run_pipeline_for(C, L, "lecture")
            assert runner._retries[SKEY]["origin"] == "pipeline"
            with patch.object(runner, "run_all", AsyncMock()):
                runner._fire_retry(SKEY)
                await _drain()
            assert runner._queue == [runner.QueueEntry(C, L, "lecture", "full")]
            assert runner._attempts[SKEY] == 1

        asyncio.run(go())

    def test_an_assignment_retry_replays_its_own_step(self):
        key = runner._skey(C, "A1", "assignment")

        async def go():
            with _fail():
                await runner.run_step(C, "A1", "assignment", "intuition")
            assert "retry" in runner._errors[key]
            with patch.object(
                runner, "try_run_assignment_step", return_value="started"
            ) as run:
                runner._fire_retry(key)
            run.assert_called_once_with(C, "A1", "intuition", retry=True)

        asyncio.run(go())

    def test_a_busy_lecture_at_fire_time_keeps_the_plain_error(self):
        async def go():
            with _fail():
                await runner.run_step(C, L, "lecture", "summarize")
            with patch.object(runner, "try_run_step", return_value="busy"):
                runner._fire_retry(SKEY)
            assert "retry" not in runner._errors[SKEY]
            assert runner._attempts == {} and runner._retries == {}

        asyncio.run(go())

    def test_a_blocked_record_is_never_retried(self):
        runner._summarize_block = {"message": "q", "params": {}}

        async def go():
            async def fake_fetch(*_a):
                return {
                    "video.mp4": {"exists": True},
                    "audio.mp3": {"exists": True},
                    "transcript.txt": {"exists": True},
                }

            with patch.object(runner, "_fetch_files", fake_fetch):
                await runner.run_pipeline_for(C, L, "lecture", honor_block=True)
            assert runner._errors[SKEY]["blocked"] is True
            assert runner._retries == {}

        asyncio.run(go())


class TestCancelAndSupersede:
    @staticmethod
    async def _armed():
        with _fail():
            await runner.run_step(C, L, "lecture", "summarize")
        return runner._retries[SKEY]["handle"]

    def test_cancel_drops_the_timer_and_the_field_but_keeps_the_error(self):
        async def go():
            handle = await self._armed()
            assert runner.cancel_retry(C, L, "lecture") is True
            assert handle.cancelled()
            assert "retry" not in runner._errors[SKEY]
            assert runner._errors[SKEY]["code"] == "gemini_overloaded"
            assert runner.cancel_retry(C, L, "lecture") is False

        asyncio.run(go())

    def test_cancel_pings_sse(self):
        async def go():
            await self._armed()
            with patch.object(runner.db_client, "notify") as notify:
                runner.cancel_retry(C, L, "lecture")
            notify.assert_called_once()

        asyncio.run(go())

    @pytest.mark.parametrize(
        "manual",
        [
            lambda: runner.try_run_step(C, L, "lecture", "summarize"),
            lambda: runner.try_run_pipeline(C, L, "lecture"),
            lambda: runner.enqueue(runner.QueueEntry(C, L, "lecture", "full")),
        ],
    )
    def test_a_manual_run_supersedes_the_waiting_retry(self, manual):
        async def go():
            handle = await self._armed()
            with (
                patch.object(runner, "run_step", AsyncMock()),
                patch.object(runner, "run_pipeline_for", AsyncMock()),
                patch.object(runner, "run_all", AsyncMock()),
            ):
                manual()
                await _drain()
            assert handle.cancelled()
            assert runner._retries == {} and runner._attempts == {}
            assert "retry" not in runner._errors[SKEY]

        asyncio.run(go())

    def test_switching_off_drops_every_pending_retry(self):
        async def go():
            handle = await self._armed()
            runner.cancel_all_retries()
            assert handle.cancelled() and runner._retries == {}
            assert "retry" not in runner._errors[SKEY]

        asyncio.run(go())

    def test_a_rename_or_delete_prune_drops_the_retry_with_the_error(self):
        async def go():
            handle = await self._armed()
            with patch.object(runner.db_client, "get_tree", return_value=[]):
                await runner.prune_stale_errors()
            assert handle.cancelled()
            assert SKEY not in runner._errors and runner._retries == {}

        asyncio.run(go())

    def test_a_prune_that_removed_an_error_notifies(self):
        async def go():
            runner._errors[SKEY] = {"code": "unknown_error", "params": {}}
            ping = []
            with (
                patch.object(runner.db_client, "get_tree", return_value=[]),
                patch.object(runner.db_client, "notify", lambda: ping.append(1)),
            ):
                await runner.prune_stale_errors()
                assert ping == [1]
                await runner.prune_stale_errors()  # nothing left to remove
                assert ping == [1]

        asyncio.run(go())

    def test_concurrent_prunes_share_one_tree_fetch(self):
        async def go():
            runner._errors[SKEY] = {"code": "unknown_error", "params": {}}
            calls = []

            def tree():
                calls.append(1)
                return []

            with patch.object(runner.db_client, "get_tree", tree):
                await asyncio.gather(*(runner.prune_stale_errors() for _ in range(5)))
            assert len(calls) == 1

        asyncio.run(go())

    def test_a_join_during_a_prune_with_a_pre_rename_tree_triggers_one_rerun(self):
        async def go():
            handle = await self._armed()
            trees = [[{"name": C, "lectures": [{"name": L}]}], []]
            calls = []
            started = asyncio.Event()
            release = asyncio.Event()

            def tree():
                calls.append(1)
                return trees[len(calls) - 1] if len(calls) <= 2 else []

            async def slow_thread(fn):
                result = fn()
                if len(calls) == 1:
                    started.set()
                    await release.wait()
                return result

            with (
                patch.object(runner.asyncio, "to_thread", slow_thread),
                patch.object(runner.db_client, "get_tree", tree),
            ):
                first = asyncio.create_task(runner.prune_stale_errors())
                await started.wait()
                joins = [
                    asyncio.create_task(runner.prune_stale_errors()) for _ in range(5)
                ]
                await asyncio.sleep(0)
                release.set()
                await asyncio.gather(first, *joins)
            assert len(calls) == 2
            assert handle.cancelled()
            assert SKEY not in runner._errors and runner._retries == {}

        asyncio.run(go())


class TestRetryVsErrorRecord:
    def test_a_summarize_start_keeps_a_quota_record_with_a_waiting_retry(self):
        async def go():
            with _fail(_quota("per_minute")):
                await runner.run_step(C, L, "lecture", "summarize")
            assert "retry" in runner._errors[SKEY]
            with _fail(calls=[]):
                await runner.run_step("C2", "L2", "lecture", "summarize")
            assert "retry" in runner._errors[SKEY]
            assert SKEY in runner._retries

        asyncio.run(go())

    def test_a_summarize_start_still_sweeps_a_quota_record_without_retry(self):
        async def go():
            runner._errors[SKEY] = {"code": "gemini_quota_exhausted", "params": {}}
            with _fail(calls=[]):
                await runner.run_step("C2", "L2", "lecture", "summarize")
            assert SKEY not in runner._errors

        asyncio.run(go())

    def test_firing_without_an_error_record_drops_the_retry_and_replays_nothing(self):
        async def go():
            calls = []
            with _fail(calls=calls):
                await runner.run_step(C, L, "lecture", "summarize")
                del runner._errors[SKEY]
                runner._fire_retry(SKEY)
                await _drain()
            assert calls == ["summarize"]
            assert SKEY not in runner._retries
            assert SKEY not in runner._attempts

        asyncio.run(go())


def test_status_answers_before_a_slow_prune_finishes():
    import threading

    import backend_main

    async def go():
        runner._errors[SKEY] = {"code": "unknown_error", "params": {}}
        release = threading.Event()
        ping = []

        def slow_tree():
            release.wait(5)
            return []

        with (
            patch.object(runner.db_client, "get_tree", slow_tree),
            patch.object(runner.db_client, "notify", lambda: ping.append(1)),
        ):
            status = await asyncio.wait_for(backend_main.runner_status_endpoint(), 1)
            assert SKEY in status["errors"] and ping == []
            release.set()
            await runner.prune_stale_errors()
        assert SKEY not in runner._errors and ping == [1]

    asyncio.run(go())
