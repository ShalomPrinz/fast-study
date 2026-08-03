import asyncio
from contextlib import asynccontextmanager
from typing import Literal, get_args

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from course import overview
from course import runner as course_runner
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pipeline import runner
from pydantic import BaseModel
from services import db_client
from timing import get_stats, init_db, record

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the APScheduler cron that auto-runs pending lectures at 03:00 daily."""

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        runner._scheduled_run, CronTrigger(hour=3, minute=0), id="run_all_daily"
    )
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(lifespan=lifespan)
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_STEP_CONFIG: dict[str, tuple[str, str]] = {
    "audio": ("video.mp4", "Download"),
    "transcribe": ("audio.mp3", "Extract Audio"),
    "summarize": ("transcript.txt", "Transcribe"),
    "pdf": ("summary.md", "Summarize"),
    "drive": ("summary.pdf", "PDF"),
}


Kind = Literal["lecture", "recitation"]
_VALID_KINDS = set(get_args(Kind))


def _validate_kind(kind: str):
    """Guard used by every route handler; 'recitation' routes files under a Recitations/ subdir."""

    if kind not in _VALID_KINDS:
        return {"status": "error", "message": f"invalid kind: {kind}"}
    return None


@app.post("/courses/{course}/lectures/{lecture}/run/{step}")
async def run_step(
    course: str,
    lecture: str,
    step: str,
    kind: Kind = Query("lecture"),
    reset_history: bool = Query(True),
):
    if step not in _STEP_CONFIG:
        return {"status": "error", "message": f"Unknown step: {step}"}
    if err := _validate_kind(kind):
        return err

    # Each step depends on the previous step's output file.
    required_file, prev_step = _STEP_CONFIG[step]
    if not await asyncio.to_thread(
        runner.db_client.file_exists, course, lecture, kind, required_file
    ):
        return {
            "status": "error",
            "message": f"{required_file} is required — run {prev_step} first",
        }
    return {
        "status": runner.try_run_step(
            course, lecture, kind, step, reset_history=reset_history
        )
    }


@app.post("/courses/{course}/lectures/{lecture}/pipeline")
async def run_pipeline(course: str, lecture: str, kind: Kind = Query("lecture")):
    if err := _validate_kind(kind):
        return err
    return {"status": runner.try_run_pipeline(course, lecture, kind)}


# ---- Overview (course-level, not per-lecture — state lives in course/runner.py) ----


async def _find_course(course: str) -> tuple[dict | None, dict | None]:
    """Locate a course node in the tree; returns (node, error envelope)."""

    tree = await asyncio.to_thread(db_client.get_tree)
    node = next((c for c in tree if c.get("name") == course), None)
    if node is None:
        return None, {"status": "error", "message": f"course not found: {course}"}
    return node, None


@app.post("/courses/{course}/overview/generate")
async def overview_generate(
    course: str,
    extractors: str | None = Query(None),
    from_phase: str | None = Query(None),
    skip_existing: bool = Query(False),
):
    """Generate a course overview for the given extractor slugs, from `from_phase`
    through to_pdf. Semantics of the run and both flags: docs/OVERVIEW.md."""

    phase, err = course_runner.resolve_from_phase(from_phase)
    if err:
        return {"status": "error", "message": err}

    slugs, err = course_runner.resolve_slugs(extractors)
    if err:
        return {"status": "error", "message": err}

    course_node, err = await _find_course(course)
    if course_node is None or err is not None:
        return err
    return {
        "status": course_runner.try_run_generate(
            course, course_node, slugs, phase, skip_existing
        )
    }


@app.get("/courses/{course}/overview/status")
def overview_status(course: str):
    """Overview status for a course, aggregated over the shared per-(course, slug) store."""

    return course_runner.get_status(course)


@app.get("/overview/extractors")
def overview_extractors():
    """Static extractor listing. `slug` is the stable id, `title` is the label."""

    return {
        "extractors": [
            {"slug": e.slug, "title": e.title, "phases": e.phase_ids}
            for e in overview.EXTRACTORS
        ]
    }


@app.post("/run-all")
async def run_all_endpoint():
    """Scan for pending lectures and run the queue, unless a run is already in progress."""

    if runner._runner_status["running"]:
        return {"status": "already_running", **runner.get_status()}
    queue = await runner.scan_pending()
    if not queue:
        return {"status": "empty_queue"}
    queue = runner.drop_in_flight(queue)
    if not queue:
        return {"status": "all_in_flight"}
    asyncio.create_task(runner.run_all(queue))
    return {"status": "started", **runner.get_status()}


@app.get("/status")
def runner_status_endpoint():
    """Live status snapshot for the runner. Cheap; polled by the UI."""

    return runner.get_status()


@app.get("/timing/{operation}")
def timing_stats(operation: str, file_size_bytes: int = Query(...)):
    """Return a calibrated ETA estimate for the given operation and file size."""

    return get_stats(operation, file_size_bytes)


class TimingSample(BaseModel):
    operation: str
    file_size_bytes: int
    duration_seconds: float


@app.post("/timing")
def timing_record(sample: TimingSample):
    """Record one duration sample."""

    return record(sample.operation, sample.file_size_bytes, sample.duration_seconds)
