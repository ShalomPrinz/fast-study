import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from fastapi import FastAPI, Query
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


def _validate_kind(kind: str):
    """Guard used by every route handler; 'recitation' routes files under a Recitations/ subdir."""
    if kind not in {"lecture", "recitation"}:
        return {"status": "error", "message": f"invalid kind: {kind}"}
    return None


@app.post("/courses/{course}/lectures/{lecture}/run/audio")
def run_audio(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    return runner.execute_step(course, lecture, kind, "audio")


@app.post("/courses/{course}/lectures/{lecture}/run/transcribe")
def run_transcribe(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    return runner.execute_step(course, lecture, kind, "transcribe")


@app.post("/courses/{course}/lectures/{lecture}/run/summarize")
def run_summarize(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    return runner.execute_step(course, lecture, kind, "summarize")


@app.post("/courses/{course}/lectures/{lecture}/run/pdf")
def run_pdf(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    return runner.execute_step(course, lecture, kind, "pdf")


@app.post("/courses/{course}/lectures/{lecture}/run/drive")
def run_drive(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    return runner.execute_step(course, lecture, kind, "drive")


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
