"""Background runner that finishes lectures whose pipelines stopped mid-way.

A lecture is "finished" iff `drive_url.txt` exists. This module scans the tree,
queues lectures that have `video.mp4` but lack `drive_url.txt`, and advances
each one through the pipeline sequentially. The transcribe step's
`rate_limited` response triggers a 1-hour sleep and a retry of the same step
(Groq enforces an hourly ASR quota; nothing else will succeed sooner)."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from services import db_client

log = logging.getLogger("resume")
if not log.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log.setLevel(logging.INFO)


STEP_ORDER = ["audio", "transcribe", "summarize", "pdf", "drive"]

# step -> output file produced. None means already done (drive_url.txt present).
STEP_OUTPUT = {
    "audio":     "audio.mp3",
    "transcribe": "transcript.txt",
    "summarize": "summary.md",
    "pdf":       "summary.pdf",
    "drive":     "drive_url.txt",
}

RATE_LIMIT_SLEEP_SECONDS = 3600

_lock = asyncio.Lock()
_status: dict = {
    "running": False,
    "started_at": None,
    "total": 0,
    "done": 0,
    "current": None,
    "last_error": None,
    "sleeping_until": None,
}


def get_status() -> dict:
    """Return a snapshot of the live resume status dict."""
    return dict(_status)


def next_step(files: dict) -> Optional[str]:
    """Given a {filename: {exists: bool, ...}} mapping for one lecture, return
    the next pipeline step name to run, or None if drive_url.txt already exists.

    A step is skipped iff its output file already exists. Steps run in
    STEP_ORDER; the first step whose output is missing is returned."""

    def has(name: str) -> bool:
        entry = files.get(name)
        return bool(entry and entry.get("exists"))

    if has("drive_url.txt"):
        return None
    for step in STEP_ORDER:
        if not has(STEP_OUTPUT[step]):
            return step
    return None


def _lecture_pending(files: dict) -> bool:
    """A lecture is pending iff it has video.mp4 but no drive_url.txt."""
    video = files.get("video.mp4") or {}
    drive = files.get("drive_url.txt") or {}
    return bool(video.get("exists")) and not bool(drive.get("exists"))


async def scan_pending() -> list[tuple[str, str, str]]:
    """Walk the full tree; return (course, lecture, kind) triples for every
    lecture/recitation that has video.mp4 but no drive_url.txt."""

    tree = await asyncio.to_thread(db_client.get_tree)
    pending: list[tuple[str, str, str]] = []
    for course in tree:
        course_name = course["name"]
        for lec in course.get("lectures") or []:
            if _lecture_pending(lec.get("files") or {}):
                pending.append((course_name, lec["name"], "lecture"))
        for rec in course.get("recitations") or []:
            if _lecture_pending(rec.get("files") or {}):
                pending.append((course_name, rec["name"], "recitation"))
    return pending


async def _fetch_files(course: str, lecture: str, kind: str) -> dict:
    """Build a {filename: {exists}} mapping for one lecture via HEAD calls."""
    names = ["video.mp4", "audio.mp3", "transcript.txt", "summary.md", "summary.pdf", "drive_url.txt"]
    out: dict[str, dict] = {}
    for name in names:
        exists = await asyncio.to_thread(db_client.file_exists, course, lecture, kind, name)
        out[name] = {"exists": exists}
    return out


async def _call_step(course: str, lecture: str, kind: str, step: str) -> dict:
    """Invoke the local backend pipeline step in a worker thread.

    Lazy import breaks the main.py ↔ resume.py cycle. The route handlers are
    sync; running them via to_thread keeps the event loop free for /resume-status
    polling and other requests while a step is in flight."""

    from main import run_audio, run_transcribe, run_summarize, run_pdf, run_drive
    handlers = {
        "audio":     run_audio,
        "transcribe": run_transcribe,
        "summarize": run_summarize,
        "pdf":       run_pdf,
        "drive":     run_drive,
    }
    handler = handlers[step]
    return await asyncio.to_thread(handler, course, lecture, kind)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def run_pipeline_for(course: str, lecture: str, kind: str) -> None:
    """Drive one lecture to completion. Rate-limit → sleep 1h, retry same step.
    Error → record, stop this lecture (caller advances to next)."""

    while True:
        files = await _fetch_files(course, lecture, kind)
        step = next_step(files)
        if step is None:
            log.info("pipeline complete: %s/%s (%s)", course, lecture, kind)
            return
        log.info("running step '%s' for %s/%s (%s)", step, course, lecture, kind)
        _status["current"] = {"course": course, "lecture": lecture, "kind": kind, "step": step, "started_at": _now_iso()}
        db_client.notify()
        result = await _call_step(course, lecture, kind, step)
        status = result.get("status")
        log.info("step '%s' for %s/%s -> %s", step, course, lecture, status)
        if status == "done":
            db_client.notify()
            continue
        if status == "rate_limited":
            wake = datetime.now(timezone.utc) + timedelta(seconds=RATE_LIMIT_SLEEP_SECONDS)
            _status["sleeping_until"] = wake.isoformat()
            log.info("rate limited on '%s' for %s/%s; sleeping %ds until %s", step, course, lecture, RATE_LIMIT_SLEEP_SECONDS, wake.isoformat())
            db_client.notify()
            try:
                await asyncio.sleep(RATE_LIMIT_SLEEP_SECONDS)
            finally:
                _status["sleeping_until"] = None
            log.info("waking up; retrying step '%s' for %s/%s", step, course, lecture)
            db_client.notify()
            # retry same step on same lecture
            continue
        # error or unknown
        msg = result.get("message") or status
        log.error("step '%s' for %s/%s failed: %s", step, course, lecture, msg)
        _status["last_error"] = f"{course}/{lecture} [{step}]: {msg}"
        db_client.notify()
        return


async def resume_all(queue: list[tuple[str, str, str]]) -> dict:
    """Run every lecture in queue to completion sequentially. Caller is responsible
    for scanning and passing a non-empty queue; this function never re-scans."""

    async with _lock:
        log.info("resume_all starting with %d pending lecture(s): %s", len(queue), [f"\n{c}/{l} ({k})" for c, l, k in queue])
        _status["running"] = True
        _status["started_at"] = _now_iso()
        _status["done"] = 0
        _status["total"] = len(queue)
        _status["current"] = None
        _status["last_error"] = None
        _status["sleeping_until"] = None
        # No notify here: first useful frontend state is when `current` is set inside
        # run_pipeline_for. Earlier notifies (current=None) create a rapid-fire burst
        # whose parallel refreshes can reorder and overwrite the fresh snapshot.
        try:
            for (course, lecture, kind) in queue:
                log.info("=== starting pipeline %d/%d: %s/%s (%s) ===", _status["done"] + 1, _status["total"], course, lecture, kind)
                try:
                    await run_pipeline_for(course, lecture, kind)
                except Exception as e:
                    log.exception("pipeline crashed for %s/%s: %s", course, lecture, e)
                    _status["last_error"] = f"{course}/{lecture}: {e}"
                _status["done"] += 1
                db_client.notify()
            log.info("resume_all completed: %d/%d done, last_error=%s", _status["done"], _status["total"], _status["last_error"])
            return {"status": "completed", **get_status()}
        finally:
            _status["running"] = False
            _status["current"] = None
            _status["sleeping_until"] = None
            db_client.notify()


async def _scheduled_resume() -> None:
    """Cron entry point: already running - skip. Otherwise scan, then run if anything pending."""

    if _lock.locked():
        log.info("cron: resume already running, skipping")
        return
    queue = await scan_pending()
    if not queue:
        log.info("cron: nothing pending")
        return
    await resume_all(queue)
