import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from timing import init_db, get_stats
import runner

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the APScheduler cron that auto-resumes pending lectures at 03:00 daily."""
    scheduler = AsyncIOScheduler()
    scheduler.add_job(runner._scheduled_resume, CronTrigger(hour=3, minute=0), id="resume_all_daily")
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
    "audio":      ("video.mp4",      "Download"),
    "transcribe": ("audio.mp3",      "Extract Audio"),
    "summarize":  ("transcript.txt", "Transcribe"),
    "pdf":        ("summary.md",     "Summarize"),
    "drive":      ("summary.pdf",    "PDF"),
}


def _validate_kind(kind: str):
    """Guard used by every route handler; 'recitation' routes files under a Recitations/ subdir."""
    if kind not in {"lecture", "recitation"}:
        return {"status": "error", "message": f"invalid kind: {kind}"}
    return None


@app.post("/courses/{course}/lectures/{lecture}/run/{step}")
async def run_step(course: str, lecture: str, step: str, kind: str = Query("lecture")):
    # Allowed steps are stricrly defined in STEP_CONFIG
    if step not in _STEP_CONFIG:
        raise HTTPException(status_code=404, detail=f"Unknown step: {step}")
    
    # Validate lecture kind
    if err := _validate_kind(kind): return err

    # Each step depends on the previous step's output file; check existence before running.
    required_file, prev_step = _STEP_CONFIG[step]
    if not await asyncio.to_thread(runner.db_client.file_exists, course, lecture, kind, required_file):
        return {"status": "error", "message": f"{required_file} is required — run {prev_step} first"}
    
    # Run step and immidiately return status (started / busy)
    return {"status": runner.try_run_step(course, lecture, kind, step)}


@app.post("/courses/{course}/lectures/{lecture}/pipeline")
async def run_pipeline(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    return {"status": runner.try_run_pipeline(course, lecture, kind)}


@app.post("/resume-all")
async def resume_all_endpoint():
    """Resume all: Already running or no pending lectures — skip. Otherwise call resume_all with scanned queue."""
    if runner._resume_status["running"]:
        return {"status": "already_running", **runner.get_status()}
    queue = await runner.scan_pending()
    if not queue:
        return {"status": "empty_queue"}
    asyncio.create_task(runner.resume_all(queue))
    return {"status": "started", **runner.get_status()}


@app.get("/status")
@app.get("/resume-status")
def resume_status_endpoint():
    """Live status snapshot for the resume runner. Cheap; polled by the UI."""
    return runner.get_status()


@app.get("/timing/{operation}")
def timing_stats(operation: str, file_size_bytes: int = Query(...)):
    """Return a calibrated ETA estimate for the given operation and file size."""
    return get_stats(operation, file_size_bytes)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
