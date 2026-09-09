import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from pipeline import runner, schedule


def _hour(job) -> int:
    """The hour field of a cron job's trigger, as an int."""

    return int(str(next(f for f in job.trigger.fields if f.name == "hour")))


@pytest.fixture(autouse=True)
def _fresh_scheduler(monkeypatch):
    # A module-level scheduler would otherwise carry jobs between tests; never started, so the
    # jobs stay pending and no event loop is needed.
    monkeypatch.setattr(schedule, "_scheduler", AsyncIOScheduler())


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("NIGHTLY_RUN", raising=False)
    monkeypatch.delenv("NIGHTLY_HOUR", raising=False)


class TestApply:
    def test_unset_settings_schedule_the_job_at_03_00(self):
        schedule.apply()
        job = schedule._scheduler.get_job(schedule.JOB_ID)
        assert _hour(job) == 3
        assert job.func is runner._scheduled_run

    def test_off_to_on_adds_the_job(self, monkeypatch):
        monkeypatch.setenv("NIGHTLY_RUN", "false")
        schedule.apply()
        assert schedule._scheduler.get_job(schedule.JOB_ID) is None

        monkeypatch.setenv("NIGHTLY_RUN", "true")
        monkeypatch.setenv("NIGHTLY_HOUR", "7")
        schedule.apply()
        assert _hour(schedule._scheduler.get_job(schedule.JOB_ID)) == 7

    def test_an_hour_change_reschedules_the_one_job(self, monkeypatch):
        monkeypatch.setenv("NIGHTLY_HOUR", "1")
        schedule.apply()
        monkeypatch.setenv("NIGHTLY_HOUR", "22")
        schedule.apply()
        jobs = schedule._scheduler.get_jobs()
        assert len(jobs) == 1
        assert _hour(jobs[0]) == 22

    def test_on_to_off_removes_the_job(self, monkeypatch):
        schedule.apply()
        monkeypatch.setenv("NIGHTLY_RUN", "off")
        schedule.apply()
        assert schedule._scheduler.get_jobs() == []

    def test_off_is_idempotent_with_no_job(self, monkeypatch):
        monkeypatch.setenv("NIGHTLY_RUN", "0")
        schedule.apply()
        schedule.apply()
        assert schedule._scheduler.get_jobs() == []

    def test_reapplying_the_same_hour_keeps_one_job(self, monkeypatch):
        monkeypatch.setenv("NIGHTLY_HOUR", "5")
        schedule.apply()
        schedule.apply()
        jobs = schedule._scheduler.get_jobs()
        assert len(jobs) == 1
        assert _hour(jobs[0]) == 5
