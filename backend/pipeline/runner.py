"""Per-lecture execution engine: step executors, in-flight tracking, orchestration.
All pipeline state, logic and scheduling lives here. See docs/PIPELINE.md."""

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
from services.llm_client import GeminiRateLimitError

from pipeline.strip_audio import strip_audio
from pipeline.summarize import summarize
from pipeline.to_pdf import PdfRenderError, convert_to_pdf
from pipeline.transcribe import (
    PARTIAL_META,
    PARTIAL_TXT,
    TranscribeRateLimitError,
    transcribe_audio,
)
from pipeline.upload_to_drive import upload_to_drive

log = logging.getLogger("runner")

RECITATIONS_DIR = "Recitations"
STEP_ORDER = ["audio", "transcribe", "summarize", "pdf", "drive"]
STEP_OUTPUT = {
    "audio": "audio.mp3",
    "transcribe": "transcript.txt",
    "summarize": "summary.md",
    "pdf": "summary.pdf",
    "drive": "drive_url.txt",
}
# Dotfiles beside summary.pdf: the classified non-fatal warning (rides the tree as the
# summary.pdf entry's `warning`), and the generated LaTeX kept only on a hard failure.
PDF_WARNING_FILE = ".pdf_warning"
PDF_BUILD_TEX_FILE = ".pdf_build.tex"
RATE_LIMIT_SLEEP_SECONDS = 3600  # Groq's hourly ASR window; transcribe's fallback
GEMINI_MINUTE_QUOTA_SLEEP_SECONDS = 60

_locks: dict[
    tuple[str, str, str], asyncio.Lock
] = {}  # per-lecture; created lazily via setdefault
_in_flight: dict[str, dict] = {}  # skey → entry; cleared on step completion or error
_errors: dict[
    str, str
] = {}  # skey → last error message; survives after _in_flight clears
_runner_status: dict = {"running": False, "total": 0, "done": 0, "last_error": None}
_summarize_blocked = False  # run-scoped; set on Gemini's DAILY quota, reset by run_all


def _lkey(course: str, lecture: str, kind: str) -> tuple[str, str, str]:
    """Tuple key into _locks — the dict holds Lock objects, not serialisable data."""

    return (course, lecture, kind)


def _skey(course: str, lecture: str, kind: str) -> str:
    """String key into _in_flight and _errors; appears verbatim in /status output."""

    return f"{course}||{lecture}||{kind}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_status() -> dict:
    """Snapshot of all live state; returned verbatim by GET /status."""

    return {
        "runner": dict(_runner_status),
        "in_flight": list(_in_flight.values()),
        "errors": dict(_errors),
    }


# ---- empty-file guard ----

# A 0-byte pipeline file means the producing tool returned success with no content
# and raised nothing, so map each file to its likely cause for the error message.
EMPTY_FILE_ISSUES: dict[str, str] = {
    "video.mp4": "the source video is empty or was not fully uploaded",
    "audio.mp3": "ffmpeg produced no audio — the video may have no audio track or be corrupt",
    "transcript.txt": "Whisper returned no text — the audio may be silent or corrupt",
    "summary.md": "Gemini returned no text",
    "summary.pdf": "pandoc produced an empty PDF — summary.md may be empty or malformed",
    "drive_url.txt": "the Drive upload returned no share URL",
}


def _require_nonempty(filename: str, data: bytes) -> None:
    """Reject a 0-byte pipeline file at every read and write — advancing on one
    (`next_step` counts it as "exists") surfaces a misleading downstream error."""

    if not data:
        hint = EMPTY_FILE_ISSUES.get(filename)
        raise RuntimeError(f"{filename} is empty" + (f" — {hint}" if hint else ""))


# ---- db_workspace ----


@contextmanager
def _db_workspace(course: str, lecture: str, kind: str, *, download=(), upload=()):
    """Tempdir scoped to one pipeline step: downloads named inputs and uploads named
    outputs on clean exit, guarding both ends against 0-byte files."""

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        paths = {name: tmp_path / name for name in set(download) | set(upload)}
        for name in download:
            data = db_client.get_file_bytes(course, lecture, kind, name)
            _require_nonempty(name, data)
            paths[name].write_bytes(data)
        yield paths
        for name in upload:
            data = paths[name].read_bytes()
            _require_nonempty(name, data)
            db_client.put_file_bytes(course, lecture, kind, name, data)


# ---- Step executors ----


def _exec_audio(course: str, lecture: str, kind: str) -> dict:
    """Strip audio from video.mp4 → audio.mp3 via ffmpeg. Returns {status: done|error}."""

    try:
        if not db_client.file_exists(course, lecture, kind, "video.mp4"):
            return {"status": "error", "message": "video.mp4 is required"}
        with _db_workspace(
            course, lecture, kind, download=["video.mp4"], upload=["audio.mp3"]
        ) as ws:
            strip_audio(str(ws["video.mp4"]), str(ws["audio.mp3"]))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _persist_transcribe_partial(
    course: str, lecture: str, kind: str, tmp: Path
) -> None:
    """Persist transcription partial state. Runs on any transcribe mid-run failure."""

    for name in (PARTIAL_TXT, PARTIAL_META):
        p = tmp / name
        if p.exists():
            db_client.put_file_bytes(course, lecture, kind, name, p.read_bytes())


def _exec_transcribe(course: str, lecture: str, kind: str) -> dict:
    """Transcribe audio.mp3 → transcript.txt via Groq Whisper, resuming from partial state if present.
    Returns {status: done|error|rate_limited}; rate_limited carries progress chunk counts."""

    try:
        if not db_client.file_exists(course, lecture, kind, "audio.mp3"):
            return {
                "status": "error",
                "message": "audio.mp3 is required — run Extract Audio first",
            }

        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "audio.mp3"
            audio_bytes = db_client.get_file_bytes(course, lecture, kind, "audio.mp3")
            _require_nonempty("audio.mp3", audio_bytes)
            audio_path.write_bytes(audio_bytes)

            # Resume validates audio mtime+size against the meta, and re-downloading gives
            # audio a fresh mtime — so restore the recorded mtime or resume restarts from 0.
            partial_meta_bytes = None
            if db_client.file_exists(course, lecture, kind, PARTIAL_META):
                partial_meta_bytes = db_client.get_file_bytes(
                    course, lecture, kind, PARTIAL_META
                )
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
                _persist_transcribe_partial(course, lecture, kind, Path(tmp))
                return {
                    "status": "rate_limited",
                    "progress": {
                        "completed": e.info["completed_chunks"],
                        "total": e.info["total_chunks"],
                    },
                }
            except Exception as e:
                _persist_transcribe_partial(course, lecture, kind, Path(tmp))
                return {"status": "error", "message": str(e)}

            transcript_bytes = transcript.encode("utf-8")
            _require_nonempty("transcript.txt", transcript_bytes)
            db_client.put_file_bytes(
                course, lecture, kind, "transcript.txt", transcript_bytes
            )
            db_client.delete_file(course, lecture, kind, PARTIAL_TXT)
            db_client.delete_file(course, lecture, kind, PARTIAL_META)
            return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _download_materials(course: str, lecture: str, kind: str, dest: Path) -> list[Path]:
    """Fetch every material PDF of a lecture into `dest`. Unlike the fixed pipeline files,
    an empty material is skipped with a warning — the transcript alone still summarizes."""

    paths: list[Path] = []
    for entry in db_client.list_materials(course, lecture, kind):
        name = entry["name"]
        data = db_client.get_file_bytes(course, lecture, kind, name)
        if not data:
            log.warning(
                "%s/%s (%s): skipping empty material %s", course, lecture, kind, name
            )
            continue
        path = dest / name
        path.write_bytes(data)
        paths.append(path)
    return paths


def _exec_summarize(course: str, lecture: str, kind: str) -> dict:
    """Summarize transcript.txt → summary.md via Gemini, passing every material PDF present.
    A daily-quota 429 is a plain error (no retry); a per-minute one is rate_limited."""

    try:
        if not db_client.file_exists(course, lecture, kind, "transcript.txt"):
            return {
                "status": "error",
                "message": "transcript.txt is required — run Transcribe first",
            }
        with _db_workspace(course, lecture, kind, download=["transcript.txt"]) as ws:
            transcript = ws["transcript.txt"]
            materials = _download_materials(course, lecture, kind, transcript.parent)
            log.info(
                "Summarize: %s",
                f"{len(materials)} materials found — passing to Gemini"
                if materials
                else "no materials found — transcript only",
            )
            summary = summarize(transcript, materials)
        # Gemini can return HTTP 200 with no text (e.g. finish_reason MALFORMED_RESPONSE).
        _require_nonempty("summary.md", summary.encode("utf-8"))
        db_client.put_summary(course, lecture, kind, summary)
        return {"status": "done", "usedMaterial": bool(materials)}
    except GeminiRateLimitError as e:
        # A daily quota's retryDelay lies: it says 59s while the quotaId says PerDay.
        if e.info["is_daily"]:
            return {"status": "error", "message": str(e), "daily_quota": True}
        return {
            "status": "rate_limited",
            "retry_after": GEMINI_MINUTE_QUOTA_SLEEP_SECONDS,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _drop_marker(course: str, lecture: str, kind: str, name: str) -> None:
    """Best-effort delete of a render marker: it runs after the render's real outcome is
    already persisted, so a failing cleanup call must not restate that outcome."""

    try:
        db_client.delete_file(course, lecture, kind, name)
    except Exception:
        log.exception("failed to delete %s", name)


def _exec_pdf(course: str, lecture: str, kind: str) -> dict:
    """Render summary.md → summary.pdf via pandoc/XeLaTeX. A render that errored but still
    produced a usable PDF is `done` with the warning persisted to .pdf_warning."""

    try:
        if not db_client.file_exists(course, lecture, kind, "summary.md"):
            return {
                "status": "error",
                "message": "summary.md is required — run Summarize first",
            }
        with _db_workspace(course, lecture, kind, upload=["summary.pdf"]) as ws:
            # summary.md comes from get_summary (envelope-wrapped), not get_file_bytes.
            md_path = ws["summary.pdf"].parent / "summary.md"
            md = db_client.get_summary(course, lecture, kind)
            _require_nonempty("summary.md", md.encode("utf-8"))
            md_path.write_text(md, encoding="utf-8")
            _, warning = convert_to_pdf(str(md_path))
        # After the workspace uploaded the PDF, so a warning never exists without it.
        # A clean render clears any stale warning (delete_file is a no-op when missing).
        if warning:
            db_client.put_file_bytes(
                course, lecture, kind, PDF_WARNING_FILE, warning.encode("utf-8")
            )
        else:
            _drop_marker(course, lecture, kind, PDF_WARNING_FILE)
        # The .tex a PREVIOUS hard failure left behind: any `l.<N>` now on offer indexes
        # this build, so a stale file would send the reader to the wrong line.
        _drop_marker(course, lecture, kind, PDF_BUILD_TEX_FILE)
        db_client.notify()
        return {"status": "done"}
    except PdfRenderError as e:
        # Keep the generated .tex so the `l.<N>` in the message is lookup-able; it lives
        # in the render's tempdir, so the exception is what carries it out.
        stored_tex = False
        if e.tex_source:
            try:
                db_client.put_file_bytes(
                    course,
                    lecture,
                    kind,
                    PDF_BUILD_TEX_FILE,
                    e.tex_source.encode("utf-8"),
                )
                stored_tex = True
            except Exception:
                log.exception("failed to store %s", PDF_BUILD_TEX_FILE)
        # The old summary.pdf survives, but overwriting the .tex just invalidated its
        # warning's `l.<N>`. Only that overwrite does — otherwise the old pair still agrees.
        if stored_tex:
            _drop_marker(course, lecture, kind, PDF_WARNING_FILE)
        return {"status": "error", "message": str(e)}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _exec_drive(course: str, lecture: str, kind: str) -> dict:
    """Upload summary.pdf to Google Drive and write the share URL to drive_url.txt."""

    try:
        if not db_client.file_exists(course, lecture, kind, "summary.pdf"):
            return {
                "status": "error",
                "message": "summary.pdf is required — run PDF first",
            }
        # Recitations live under a Recitations/ subfolder of the course folder in Drive.
        subfolder = RECITATIONS_DIR if kind == "recitation" else None
        with _db_workspace(
            course, lecture, kind, download=["summary.pdf"], upload=["drive_url.txt"]
        ) as ws:
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
    "audio": _exec_audio,
    "transcribe": _exec_transcribe,
    "summarize": _exec_summarize,
    "pdf": _exec_pdf,
    "drive": _exec_drive,
}


def execute_step(course: str, lecture: str, kind: str, step: str) -> dict:
    """Public dispatch: called by main.py route handlers."""

    return _EXECUTORS[step](course, lecture, kind)


# ---- Pipeline utilities ----


def next_step(files: dict) -> Optional[str]:
    """The first step in STEP_ORDER whose output file is missing, or None once
    drive_url.txt exists. Pure file-existence, so every trigger is resumable."""

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
    """Walk the full tree for every pending lecture/recitation as (course, lecture, kind)."""

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


def drop_in_flight(
    queue: list[tuple[str, str, str]],
) -> list[tuple[str, str, str]]:
    """Drop lectures a concurrent trigger already owns; run_all would skip them anyway."""

    return [
        entry
        for entry in queue
        if not (lock := _locks.get(_lkey(*entry))) or not lock.locked()
    ]


async def _fetch_files(course: str, lecture: str, kind: str) -> dict:
    """Build a {filename: {exists}} mapping for one lecture via parallel HEAD calls."""

    names = [
        "video.mp4",
        "audio.mp3",
        "transcript.txt",
        "summary.md",
        "summary.pdf",
        "drive_url.txt",
    ]
    results = await asyncio.gather(
        *[
            asyncio.to_thread(db_client.file_exists, course, lecture, kind, name)
            for name in names
        ]
    )
    return {name: {"exists": exists} for name, exists in zip(names, results)}


# ---- Async step/pipeline runners ----


async def _call_step(course: str, lecture: str, kind: str, step: str) -> dict:
    """Run one executor in a worker thread so the event loop stays free during blocking I/O."""

    return await asyncio.to_thread(_EXECUTORS[step], course, lecture, kind)


async def _run_step_unlocked(course: str, lecture: str, kind: str, step: str) -> None:
    """Drive one step to a terminal outcome, retrying after rate-limit sleeps.
    Unsafe: the caller must hold this lecture's lock."""

    global _summarize_blocked
    skey = _skey(course, lecture, kind)
    # Each iteration = one attempt; rate_limited cycles back, done/error exits.
    while True:
        _in_flight[skey] = {
            "course": course,
            "lecture": lecture,
            "kind": kind,
            "step": step,
            "started_at": _now_iso(),
            "sleeping_until": None,
            "progress": None,
        }
        _errors.pop(skey, None)  # clear any stale error from a previous attempt
        db_client.notify()

        result = await _call_step(course, lecture, kind, step)

        if result["status"] == "done":
            _in_flight.pop(skey, None)
            db_client.notify()
            return
        elif result["status"] == "rate_limited":
            sleep_seconds = result.get("retry_after") or RATE_LIMIT_SLEEP_SECONDS
            wake = datetime.now(timezone.utc) + timedelta(seconds=sleep_seconds)
            _in_flight[skey]["sleeping_until"] = wake.isoformat()
            _in_flight[skey]["progress"] = result.get("progress")
            db_client.notify()
            await asyncio.sleep(sleep_seconds)
            _in_flight[skey]["sleeping_until"] = None
            _in_flight[skey]["progress"] = None
            db_client.notify()
            # loop → retry same step
        else:  # error
            _in_flight.pop(skey, None)
            if result.get("daily_quota"):
                _summarize_blocked = True
            msg = result.get("message") or result.get("status") or "unknown error"
            _errors[skey] = msg
            log.error("%s/%s (%s) step %s failed: %s", course, lecture, kind, step, msg)
            db_client.notify()
            return


async def _run_pipeline_unlocked(
    course: str, lecture: str, kind: str, *, honor_block: bool = False
) -> bool:
    """Advance a lecture through its remaining steps; True iff it stopped early on the
    run-scoped summarize block. Unsafe: the caller must hold this lecture's lock."""

    while True:
        files = await _fetch_files(course, lecture, kind)
        step = next_step(files)
        if step is None:
            return False
        if step == "summarize" and honor_block and _summarize_blocked:
            log.info(
                "%s/%s (%s): summarize blocked (Gemini daily quota), stopping here",
                course,
                lecture,
                kind,
            )
            return True
        await _run_step_unlocked(course, lecture, kind, step)
        if _skey(course, lecture, kind) in _errors:
            return False  # a step error halts the whole pipeline for this lecture


async def run_step(course: str, lecture: str, kind: str, step: str) -> None:
    """Acquire the per-lecture lock, then run one step to completion (blocking the caller)."""

    async with _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock()):
        await _run_step_unlocked(course, lecture, kind, step)


async def run_pipeline_for(
    course: str, lecture: str, kind: str, *, honor_block: bool = False
) -> bool:
    """Acquire the per-lecture lock, then advance the lecture through all remaining steps.
    Returns True iff it stopped early on the run-scoped summarize block (run_all only)."""

    async with _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock()):
        return await _run_pipeline_unlocked(
            course, lecture, kind, honor_block=honor_block
        )


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
    """Run every lecture in queue to completion sequentially. The caller passes a
    non-empty queue; this never re-scans."""

    global _summarize_blocked
    log.info(
        "run_all starting with %d pending lecture(s): %s",
        len(queue),
        [f"\n{c}/{l} ({k})" for c, l, k in queue],
    )
    _summarize_blocked = False
    blocked_count = 0
    _runner_status["running"] = True
    _runner_status["done"] = 0
    _runner_status["total"] = len(queue)
    _runner_status["last_error"] = None
    # No notify: with _in_flight still empty these burst, and their parallel refreshes
    # can reorder and overwrite the fresher snapshot. Same for the per-lecture done below.
    try:
        for course, lecture, kind in queue:
            log.info(
                "=== starting pipeline %d/%d: %s/%s (%s) ===",
                _runner_status["done"] + 1,
                _runner_status["total"],
                course,
                lecture,
                kind,
            )
            lock = _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock())
            if lock.locked():
                # Skip if a concurrent trigger (e.g. a manual step run) already owns this lecture.
                log.info(
                    "lecture %s/%s (%s) already in flight, skipping",
                    course,
                    lecture,
                    kind,
                )
                _runner_status["done"] += 1
                db_client.notify()
                continue
            try:
                if await run_pipeline_for(course, lecture, kind, honor_block=True):
                    blocked_count += 1
            except Exception as e:
                log.exception("pipeline crashed for %s/%s: %s", course, lecture, e)
                _runner_status["last_error"] = f"{course}/{lecture}: {e}"
            _runner_status["done"] += 1
        blocked = (
            f", summarize skipped for {blocked_count} (Gemini daily quota)"
            if blocked_count
            else ""
        )
        log.info(
            "run_all completed: %d/%d done%s, last_error=%s",
            _runner_status["done"],
            _runner_status["total"],
            blocked,
            _runner_status["last_error"],
        )
        return {"status": "completed", **get_status()}
    finally:
        _runner_status["running"] = False
        _summarize_blocked = False
        db_client.notify()


async def _scheduled_run() -> None:
    """Cron entry point: skip if already running, else scan and run anything pending."""

    if _runner_status["running"]:
        log.info("cron: runner already running, skipping")
        return
    queue = await scan_pending()
    if not queue:
        log.info("cron: nothing pending")
        return
    await run_all(queue)
