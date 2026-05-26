"""Unified execution engine: step executors, in-flight tracking, and runner orchestration.
All state, logic and scheduling lives here."""

import asyncio
import json
import logging
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from services import db_client
from pipeline.strip_audio import strip_audio
from pipeline.transcribe import transcribe_audio, TranscribeRateLimitError, PARTIAL_TXT, PARTIAL_META
from pipeline.summarize import summarize
from pipeline.to_pdf import convert_to_pdf
from pipeline.upload_to_drive import upload_to_drive

log = logging.getLogger("runner")
if not log.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log.setLevel(logging.INFO)

RECITATIONS_DIR = "Recitations"
STEP_ORDER = ["audio", "transcribe", "summarize", "pdf", "drive"]
STEP_OUTPUT = {
    "audio":      "audio.mp3",
    "transcribe": "transcript.txt",
    "summarize":  "summary.md",
    "pdf":        "summary.pdf",
    "drive":      "drive_url.txt",
}
RATE_LIMIT_SLEEP_SECONDS = 3600

# lkey = (course, lecture, kind) tuple — hashable key into _locks.
# skey = "course||lecture||kind" string — key into _in_flight / _errors (also appears in API output).
_locks: dict[tuple[str, str, str], asyncio.Lock] = {}  # per-lecture; created lazily via setdefault
_in_flight: dict[str, dict] = {}    # skey → entry; cleared on step completion or error
_errors: dict[str, str] = {}        # skey → last error message; survives after _in_flight clears
_runner_status: dict = {"running": False, "total": 0, "done": 0, "last_error": None}


def _lkey(course: str, lecture: str, kind: str) -> tuple[str, str, str]:
    """Tuple key into _locks. Tuple (not string) so the dict holds Lock objects, not serialisable data."""
    return (course, lecture, kind)


def _skey(course: str, lecture: str, kind: str) -> str:
    """String key into _in_flight and _errors. String form appears verbatim in /status output."""
    return f"{course}||{lecture}||{kind}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_status() -> dict:
    """Snapshot of all live state; returned verbatim by GET /status."""
    return {
        "runner":    dict(_runner_status),
        "in_flight": list(_in_flight.values()),
        "errors":    dict(_errors),
    }


# ---- db_workspace ----

@contextmanager
def _db_workspace(course: str, lecture: str, kind: str, *, download=(), upload=()):
    """Tempdir scoped to one pipeline step: pre-downloads named inputs from the
    database service and uploads named outputs on clean exit. Pipeline binaries
    (ffmpeg/pandoc/Gemini) need real filesystem paths, so bytes have to land
    somewhere — this just centralizes the round-trip."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        paths = {name: tmp_path / name for name in set(download) | set(upload)}
        for name in download:
            paths[name].write_bytes(db_client.get_file_bytes(course, lecture, kind, name))
        yield paths
        for name in upload:
            db_client.put_file_bytes(course, lecture, kind, name, paths[name].read_bytes())


# ---- Step executors ----

def _exec_audio(course: str, lecture: str, kind: str) -> dict:
    """Strip audio from video.mp4 → audio.mp3 via ffmpeg. Returns {status: done|error}."""
    try:
        if not db_client.file_exists(course, lecture, kind, "video.mp4"):
            return {"status": "error", "message": "video.mp4 is required"}
        with _db_workspace(course, lecture, kind, download=["video.mp4"], upload=["audio.mp3"]) as ws:
            strip_audio(str(ws["video.mp4"]), str(ws["audio.mp3"]))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _exec_transcribe(course: str, lecture: str, kind: str) -> dict:
    """Transcribe audio.mp3 → transcript.txt via Groq Whisper, resuming from partial state if present.
    Returns {status: done|error|rate_limited}; on rate_limited, progress chunk counts are included."""
    try:
        if not db_client.file_exists(course, lecture, kind, "audio.mp3"):
            return {"status": "error", "message": "audio.mp3 is required — run Extract Audio first"}

        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "audio.mp3"
            audio_path.write_bytes(db_client.get_file_bytes(course, lecture, kind, "audio.mp3"))

            # Resume support: pipeline writes partial.txt/meta next to audio_path and
            # validates audio mtime+size against the meta. Re-downloading audio.mp3 each
            # request gives it a fresh mtime, so we mirror the stored partial state into
            # the temp dir AND fix audio's mtime to match meta — otherwise resume always
            # falls back to fresh, losing previously-transcribed chunks.
            partial_meta_bytes = None
            if db_client.file_exists(course, lecture, kind, PARTIAL_META):
                partial_meta_bytes = db_client.get_file_bytes(course, lecture, kind, PARTIAL_META)
                (Path(tmp) / PARTIAL_META).write_bytes(partial_meta_bytes)
            if db_client.file_exists(course, lecture, kind, PARTIAL_TXT):
                (Path(tmp) / PARTIAL_TXT).write_bytes(
                    db_client.get_file_bytes(course, lecture, kind, PARTIAL_TXT)
                )
            if partial_meta_bytes is not None:
                try:
                    meta = json.loads(partial_meta_bytes.decode("utf-8"))
                    mtime = meta.get("audio_mtime")
                    if isinstance(mtime, (int, float)):
                        os.utime(audio_path, (mtime, mtime))
                except (json.JSONDecodeError, OSError):
                    pass

            try:
                transcript = transcribe_audio(str(audio_path))
            except TranscribeRateLimitError as e:
                partial_txt = Path(tmp) / PARTIAL_TXT
                partial_meta = Path(tmp) / PARTIAL_META
                if partial_txt.exists():
                    db_client.put_file_bytes(course, lecture, kind, PARTIAL_TXT, partial_txt.read_bytes())
                if partial_meta.exists():
                    db_client.put_file_bytes(course, lecture, kind, PARTIAL_META, partial_meta.read_bytes())
                # The frontend no longer reads rateLimit details from HTTP responses;
                # rate-limit display comes from _in_flight state via /status.
                return {
                    "status": "rate_limited",
                    "progress": {
                        "completed": e.info["completed_chunks"],
                        "total":     e.info["total_chunks"],
                    },
                }

            db_client.put_file_bytes(course, lecture, kind, "transcript.txt", transcript.encode("utf-8"))
            db_client.delete_file(course, lecture, kind, PARTIAL_TXT)
            db_client.delete_file(course, lecture, kind, PARTIAL_META)
            return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _exec_summarize(course: str, lecture: str, kind: str) -> dict:
    """Summarize transcript.txt → summary.md via Gemini. Passes material.pdf alongside if present."""
    try:
        if not db_client.file_exists(course, lecture, kind, "transcript.txt"):
            return {"status": "error", "message": "transcript.txt is required — run Transcribe first"}
        download = ["transcript.txt"]
        has_material = db_client.file_exists(course, lecture, kind, "material.pdf")
        if has_material:
            download.append("material.pdf")
        print(f"Summarize: material.pdf {'found — passing to Gemini' if has_material else 'not found — transcript only'}")
        with _db_workspace(course, lecture, kind, download=download) as ws:
            summary = summarize(ws["transcript.txt"], ws.get("material.pdf") if has_material else None)
        db_client.put_summary(course, lecture, kind, summary)
        return {"status": "done", "usedMaterial": has_material}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _exec_pdf(course: str, lecture: str, kind: str) -> dict:
    """Render summary.md → summary.pdf via pandoc/XeLaTeX."""
    try:
        if not db_client.file_exists(course, lecture, kind, "summary.md"):
            return {"status": "error", "message": "summary.md is required — run Summarize first"}
        with _db_workspace(course, lecture, kind, upload=["summary.pdf"]) as ws:
            # summary.md comes from get_summary (envelope-wrapped), not get_file_bytes,
            # so write it into the workspace dir manually next to the pandoc output.
            md_path = ws["summary.pdf"].parent / "summary.md"
            md_path.write_text(db_client.get_summary(course, lecture, kind), encoding="utf-8")
            convert_to_pdf(str(md_path))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _exec_drive(course: str, lecture: str, kind: str) -> dict:
    """Upload summary.pdf to Google Drive and write the share URL to drive_url.txt."""
    try:
        if not db_client.file_exists(course, lecture, kind, "summary.pdf"):
            return {"status": "error", "message": "summary.pdf is required — run PDF first"}
        # Recitations live under a Recitations/ subfolder inside the course folder in Drive.
        subfolder = RECITATIONS_DIR if kind == "recitation" else None
        with _db_workspace(course, lecture, kind, download=["summary.pdf"], upload=["drive_url.txt"]) as ws:
            url = upload_to_drive(
                str(ws["summary.pdf"]),
                course,
                f"{lecture}.pdf",
                subfolder=subfolder,
            )
            ws["drive_url.txt"].write_bytes(url.encode("utf-8"))
        return {"status": "done", "url": url}
    except Exception as e:
        return {"status": "error", "message": str(e)}


_EXECUTORS = {
    "audio":      _exec_audio,
    "transcribe": _exec_transcribe,
    "summarize":  _exec_summarize,
    "pdf":        _exec_pdf,
    "drive":      _exec_drive,
}


def execute_step(course: str, lecture: str, kind: str, step: str) -> dict:
    """Public dispatch: called by main.py route handlers."""
    return _EXECUTORS[step](course, lecture, kind)


# ---- Pipeline utilities ----

def next_step(files: dict) -> Optional[str]:
    """Given a {filename: {exists: bool, ...}} mapping for one lecture, return
    the next pipeline step name to run, or None if drive_url.txt already exists.

    A step is skipped iff its output file already exists. Steps run in
    STEP_ORDER; the first step whose output is missing is returned."""

    def has(name: str) -> bool:
        entry = files.get(name)
        return bool(entry and entry.get("exists"))

    # Assumes last step's output is drive_url.txt; if it exists, the lecture is done
    if has("drive_url.txt"):
        return None
    
    # Otherwise return the first step whose output file is missing
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
    """Build a {filename: {exists}} mapping for one lecture via parallel HEAD calls."""
    names = ["video.mp4", "audio.mp3", "transcript.txt", "summary.md", "summary.pdf", "drive_url.txt"]
    results = await asyncio.gather(
        *[asyncio.to_thread(db_client.file_exists, course, lecture, kind, name) for name in names]
    )
    return {name: {"exists": exists} for name, exists in zip(names, results)}


# ---- Async step/pipeline runners ----

async def _call_step(course: str, lecture: str, kind: str, step: str) -> dict:
    """Run one executor in a worker thread so the event loop stays free during blocking I/O."""
    return await asyncio.to_thread(_EXECUTORS[step], course, lecture, kind)


async def _run_step_unlocked(course: str, lecture: str, kind: str, step: str) -> None:
    """Drive a single pipeline step to a terminal outcome (done or error), retrying after rate-limit sleeps.
    Unsafe: caller must hold _locks[_lkey(course, lecture, kind)] before calling."""
    skey = _skey(course, lecture, kind)
    # Each loop iteration = one attempt; rate_limited cycles back, done/error exits.
    while True:
        _in_flight[skey] = {
            "course": course, "lecture": lecture, "kind": kind,
            "step": step, "started_at": _now_iso(),
            "sleeping_until": None, "progress": None,
        }
        _errors.pop(skey, None)  # clear any stale error from a previous attempt
        db_client.notify()

        result = await _call_step(course, lecture, kind, step)

        if result["status"] == "done":
            _in_flight.pop(skey, None)
            db_client.notify()
            return
        elif result["status"] == "rate_limited":
            wake = datetime.now(timezone.utc) + timedelta(seconds=RATE_LIMIT_SLEEP_SECONDS)
            _in_flight[skey]["sleeping_until"] = wake.isoformat()
            _in_flight[skey]["progress"] = result.get("progress")
            db_client.notify()
            await asyncio.sleep(RATE_LIMIT_SLEEP_SECONDS)
            _in_flight[skey]["sleeping_until"] = None
            _in_flight[skey]["progress"] = None
            db_client.notify()
            # loop → retry same step
        else:  # error
            _in_flight.pop(skey, None)
            _errors[skey] = result.get("message") or result.get("status") or "unknown error"
            db_client.notify()
            return


async def _run_pipeline_unlocked(course: str, lecture: str, kind: str) -> None:
    """Advance a lecture through every remaining pipeline step until done or an error stops it.
    Unsafe: caller must hold _locks[_lkey(course, lecture, kind)] before calling."""
    while True:
        files = await _fetch_files(course, lecture, kind)
        step = next_step(files)
        if step is None:
            return
        await _run_step_unlocked(course, lecture, kind, step)
        if _skey(course, lecture, kind) in _errors:
            return  # a step error halts the whole pipeline for this lecture


async def run_step(course: str, lecture: str, kind: str, step: str) -> None:
    """Acquire the per-lecture lock, then run one step to completion (blocking the caller)."""
    async with _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock()):
        await _run_step_unlocked(course, lecture, kind, step)


async def run_pipeline_for(course: str, lecture: str, kind: str) -> None:
    """Acquire the per-lecture lock, then advance the lecture through all remaining steps."""
    async with _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock()):
        await _run_pipeline_unlocked(course, lecture, kind)


def try_run_step(course: str, lecture: str, kind: str, step: str) -> str:
    """Fire-and-forget run_step if the lecture isn't already locked. Returns 'busy' or 'started'."""
    lock = _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock())
    if lock.locked():
        return "busy"
    asyncio.create_task(run_step(course, lecture, kind, step))
    return "started"


def try_run_pipeline(course: str, lecture: str, kind: str) -> str:
    """Fire-and-forget run_pipeline_for if the lecture isn't already locked. Returns 'busy' or 'started'."""
    lock = _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock())
    if lock.locked():
        return "busy"
    asyncio.create_task(run_pipeline_for(course, lecture, kind))
    return "started"


# ---- Runner orchestration ----

async def run_all(queue: list[tuple[str, str, str]]) -> dict:
    """Run every lecture in queue to completion sequentially. Caller is responsible
    for scanning and passing a non-empty queue; this function never re-scans."""
    log.info("run_all starting with %d pending lecture(s): %s", len(queue), [f"\n{c}/{l} ({k})" for c, l, k in queue])
    _runner_status["running"] = True
    _runner_status["done"] = 0
    _runner_status["total"] = len(queue)
    _runner_status["last_error"] = None
    # No notify here: first useful frontend state is when first step is in-flight.
    # Earlier notifies (in_flight still empty) create a rapid-fire burst whose
    # parallel refreshes can reorder and overwrite the fresh snapshot.
    try:
        for (course, lecture, kind) in queue:
            log.info("=== starting pipeline %d/%d: %s/%s (%s) ===", _runner_status["done"] + 1, _runner_status["total"], course, lecture, kind)
            lock = _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock())
            if lock.locked():
                # Skip if a concurrent trigger (e.g. a manual step run) already owns this lecture.
                log.info("lecture %s/%s (%s) already in flight, skipping", course, lecture, kind)
                _runner_status["done"] += 1
                db_client.notify()
                continue
            try:
                await run_pipeline_for(course, lecture, kind)
            except Exception as e:
                log.exception("pipeline crashed for %s/%s: %s", course, lecture, e)
                _runner_status["last_error"] = f"{course}/{lecture}: {e}"
            _runner_status["done"] += 1
            # No notify here to prevent race condition.
            # Next step will notify, or if on last lecture, final status update after the loop.
        log.info("run_all completed: %d/%d done, last_error=%s", _runner_status["done"], _runner_status["total"], _runner_status["last_error"])
        return {"status": "completed", **get_status()}
    finally:
        _runner_status["running"] = False
        db_client.notify()


async def _scheduled_run() -> None:
    """Cron entry point: already running — skip. Otherwise scan, then run if anything pending."""
    if _runner_status["running"]:
        log.info("cron: runner already running, skipping")
        return
    queue = await scan_pending()
    if not queue:
        log.info("cron: nothing pending")
        return
    await run_all(queue)
