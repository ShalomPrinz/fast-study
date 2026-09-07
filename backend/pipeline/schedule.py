"""The nightly catch-up cron. Owns the APScheduler instance so POST /config can re-apply the
NIGHTLY_RUN / NIGHTLY_HOUR settings on the running process, not just the lifespan."""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services import settings

from pipeline import runner

log = logging.getLogger("runner")

JOB_ID = "run_all_daily"

_scheduler = AsyncIOScheduler()


def apply() -> None:
    """Sync the cron job to the current settings — add, reschedule or remove. Idempotent, so
    a caller never has to work out whether a nightly setting actually changed."""

    if not settings.nightly_run():
        if _scheduler.get_job(JOB_ID):
            _scheduler.remove_job(JOB_ID)
            log.info("nightly catch-up is off")
        return

    hour = settings.nightly_hour()
    trigger = CronTrigger(hour=hour, minute=0)
    # Reschedule rather than re-add: before start() the job is only pending, and there
    # add_job(replace_existing=True) queues a second copy instead of replacing the first.
    if _scheduler.get_job(JOB_ID):
        _scheduler.reschedule_job(JOB_ID, trigger=trigger)
    else:
        _scheduler.add_job(runner._scheduled_run, trigger, id=JOB_ID)
    log.info(f"nightly catch-up scheduled for {hour:02d}:00")


def start() -> None:
    """Schedule the job the current settings ask for, then run the scheduler."""

    apply()
    _scheduler.start()


def shutdown() -> None:
    """Stop the scheduler; a job already running is not waited for."""

    _scheduler.shutdown(wait=False)
