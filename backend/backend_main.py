import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Literal

import runtime
from course import overview
from course import runner as course_runner
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from logging_setup import setup_logging
from pipeline import runner, schedule
from pydantic import BaseModel
from services import db_client, google_auth, providers, settings
from services.errors import CodedError, failure
from timing import get_stats, init_db, record
from tools import check_tools

setup_logging()
log = logging.getLogger("api")

# Probed once at startup, never per request: the boot screen polls /health, and re-spawning three
# binaries per poll costs more than the answer. A tool installed later is seen on the next launch.
TOOLS = ("ffmpeg", "pandoc", "tectonic")

# The dev port, and the fallback the packaged launcher gets when FASTSTUDY_PORT is unset. Read by
# `delivery/entry.py` too, so the frozen dispatcher and the `__main__` path below cannot diverge.
DEFAULT_PORT = 8000
tool_status = check_tools(TOOLS)
for _name, _state in tool_status.items():
    if _state != "ok":
        # A usable tool is the bare string "ok"; a failure is a {state, params} record.
        log.error(f"{_name} is {_state['state']} — the steps that need it will fail")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run the nightly catch-up cron for the lifetime of the app; NIGHTLY_RUN and
    NIGHTLY_HOUR decide whether it is scheduled and when."""

    schedule.start()
    try:
        yield
    finally:
        schedule.shutdown()


app = FastAPI(lifespan=lifespan)
init_db()

# Added first so the CORS middleware below ends up outside it.
runtime.install_secret_check(app)


@app.middleware("http")
async def answer_failures_as_json(request, call_next):
    """Answer an escaped exception with the same {error, code, params} body as every other
    failure — FastAPI's own 500 is plain text, which no client can parse. Inside CORS, so the
    browser is allowed to read it."""

    try:
        return await call_next(request)
    except db_client.DbClientError as e:
        log.exception("storage call failed on %s", request.url.path)
        return _error(failure(str(e), "storage_unavailable", detail=str(e)), 500)
    except Exception as e:
        log.exception("unhandled error on %s", request.url.path)
        return _error(failure(str(e), "internal_error", detail=str(e)), 500)


# CORS stays the LAST add_middleware call: Starlette makes the last-added middleware the outermost,
# and a 401 raised outside CORS carries no CORS headers, which the browser reports as a network error.
app.add_middleware(
    CORSMiddleware,
    # `app://bundle` is the packaged frontend's origin, exactly as Chromium sends it — no trailing
    # slash, unlike the same origin reported by Electron's permission-handler API. Never derive it.
    allow_origins=["http://localhost:5173", "app://bundle"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Liveness plus the boot-time tool probe, and nothing else on purpose: paths, config and
    key-set flags stay on routes that can be refused."""

    return {"status": "ok", "tools": tool_status}


# Per step: the file it reads, the step that produces it, and that step's display label. The id
# is what the wire carries; the label exists only for the English prose.
_STEP_CONFIG: dict[str, tuple[str, str, str]] = {
    "audio": ("video.mp4", "download", "Download"),
    "transcribe": ("audio.mp3", "audio", "Extract Audio"),
    "summarize": ("transcript.txt", "transcribe", "Transcribe"),
    "pdf": ("summary.md", "summarize", "Summarize"),
    "drive": ("summary.pdf", "pdf", "PDF"),
}


# 'recitation' routes files under a Recitations/ subdir; FastAPI answers any other value 422.
Kind = Literal["lecture", "recitation"]


def _error(body: dict, status: int):
    """Answer with a failure body ({error, code, params}) — the shape database/ answers with too."""

    return JSONResponse(body, status_code=status)


# The refusals from database/ that name something the user can fix rather than a storage outage.
# A route reading through db_client that can get one answers it by name (409) instead of letting the
# middleware call the storage unreachable; every other code re-raises, because the middleware only
# names failures it was given and never translates a peer code into the backend's vocabulary.
_USER_ACTIONABLE_STORAGE_CODES = frozenset({"data_root_not_configured"})


def _is_user_actionable(e: db_client.DbClientError) -> bool:
    """True when the storage refused for a reason the user can act on, not a failed call."""

    return e.code in _USER_ACTIONABLE_STORAGE_CODES


@app.post("/courses/{course}/lectures/{lecture}/run/{step}")
async def run_step(course: str, lecture: str, step: str, kind: Kind = Query("lecture")):
    if step not in _STEP_CONFIG:
        return _error(failure(f"Unknown step: {step}", "unknown_step", step=step), 404)
    if step not in runner.enabled_steps():
        return _error(
            failure(f"{step} is disabled in settings", "step_disabled", step=step), 409
        )

    # Each step depends on the previous step's output file.
    required_file, prev_step, prev_label = _STEP_CONFIG[step]
    if not await asyncio.to_thread(
        runner.db_client.file_exists, course, lecture, kind, required_file
    ):
        return _error(
            failure(
                f"{required_file} is required — run {prev_label} first",
                "missing_prerequisite",
                file=required_file,
                step=prev_step,
            ),
            409,
        )
    return {"status": runner.try_run_step(course, lecture, kind, step)}


@app.post("/courses/{course}/lectures/{lecture}/pipeline")
async def run_pipeline(course: str, lecture: str, kind: Kind = Query("lecture")):
    return {"status": runner.try_run_pipeline(course, lecture, kind)}


@app.post("/courses/{course}/lectures/{lecture}/video-arrived")
async def video_arrived(course: str, lecture: str, kind: Kind = Query("lecture")):
    """A new video.mp4 landed on disk. The database reports the fact; AUTO_RUN decides how much
    of the pipeline it starts, and the work is queued rather than run inline."""

    return {"status": runner.enqueue_arrival(course, lecture, kind)}


# ---- Overview (course-level, not per-lecture — state lives in course/runner.py) ----


async def _find_course(course: str) -> dict | None:
    """Locate a course node in the tree; None when no course goes by that name."""

    tree = await asyncio.to_thread(db_client.get_tree)
    return next((c for c in tree if c.get("name") == course), None)


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
        return _error(err, 400)

    slugs, err = course_runner.resolve_slugs(extractors)
    if err:
        return _error(err, 400)

    try:
        course_node = await _find_course(course)
    except db_client.DbClientError as e:
        if not _is_user_actionable(e):
            raise
        return _error(failure(str(e), e.code, **e.params), 409)
    if course_node is None:
        return _error(
            failure(f"course not found: {course}", "course_not_found", course=course),
            404,
        )
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
    """Scan for pending lectures and queue them, unless a run is already in progress. Always the
    full pipeline — AUTO_RUN caps automatic work, never a run the user asked for."""

    if runner._runner_status["running"]:
        return {"status": "already_running", **runner.get_status()}
    try:
        pending = await runner.scan_pending()
    except db_client.DbClientError as e:
        if not _is_user_actionable(e):
            raise
        return _error(failure(str(e), e.code, **e.params), 409)
    if not pending:
        return {"status": "empty_queue"}
    queued = [
        runner.enqueue(runner.QueueEntry(course, lecture, kind, "full"))
        for course, lecture, kind in pending
    ]
    if not any(queued):
        return {"status": "all_in_flight"}
    runner.db_client.notify()
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

    try:
        return record(sample.operation, sample.file_size_bytes, sample.duration_seconds)
    except CodedError as e:
        return _error(failure(str(e), e.code, **e.params), 400)


# ---- Config ----


class ConfigUpdate(BaseModel):
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    gemini_model: str | None = None
    drive_enabled: bool | None = None
    gdrive_root_folder: str | None = None
    auto_run: str | None = None
    nightly_run: bool | None = None
    nightly_hour: int | None = None


class KeyProbe(BaseModel):
    provider: str
    key: str


@app.post("/config")
def config_update(update: ConfigUpdate):
    """Apply a partial settings body to the running process; omitted fields are left alone.
    The response names the applied fields only — a key value is never logged or echoed."""

    applied = settings.apply_config(update.model_dump(exclude_unset=True))
    # Unconditional: apply() is idempotent, so it costs less than tracking which fields moved.
    schedule.apply()
    return {"status": "ok", "applied": applied}


@app.get("/config/options")
def config_options():
    """The choices the settings screens render: the provider table (minus its internal
    base URL and probe) and the curated Gemini model list."""

    return {
        "providers": providers.public_providers(),
        "gemini_models": settings.GEMINI_MODELS,
    }


@app.post("/config/probe-key")
async def config_probe_key(probe: KeyProbe):
    """Check one API key against its provider. → `{"result": "valid"|"rejected"|"unverified"}`;
    `unverified` means we could not reach the provider, never that the key is bad."""

    if probe.provider not in providers.PROVIDERS:
        return _error(
            failure(
                f"unknown provider: {probe.provider}",
                "unknown_provider",
                provider=probe.provider,
            ),
            400,
        )
    result = await asyncio.to_thread(providers.probe_key, probe.provider, probe.key)
    return {"result": result}


@app.get("/config/drive/status")
def drive_status():
    """Whether a Drive token is stored, a consent flow is waiting on the user, and whether a
    pipeline step gave up for want of a token."""

    return google_auth.drive_status()


@app.post("/config/drive/connect")
async def drive_connect():
    """Start the Google consent flow and answer with its URL, without waiting for the user.
    The backend opens the browser itself, so the URL is the UI's 'didn't open?' fallback."""

    try:
        auth_url = await asyncio.to_thread(google_auth.start_consent)
    except CodedError as e:
        return _error(failure(str(e), e.code, **e.params), 500)
    return {"auth_url": auth_url}


@app.post("/config/drive/disconnect")
def drive_disconnect():
    """Delete the stored Drive token; already disconnected is success."""

    google_auth.disconnect()
    return {"status": "ok"}


# Packaged entry point only — dev runs `uvicorn backend_main:app --reload`, which never reaches this.
if __name__ == "__main__":
    runtime.serve(app, default_port=DEFAULT_PORT)
