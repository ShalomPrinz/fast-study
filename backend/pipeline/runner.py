"""Per-lecture execution engine: step executors, in-flight tracking, orchestration.
All pipeline state, logic and scheduling lives here. See docs/PIPELINE.md."""

import asyncio
import json
import logging
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import NamedTuple, Optional

import sentry_sdk
from course import runner as course_runner
from services import auto_retry, db_client, google_auth, notices, settings
from services.errors import (
    CONDITION_CODES,
    CodedError,
    app_files_blocked,
    own_fields,
)
from services.llm_client import GeminiRateLimitError

from pipeline.extract_text import extract_text
from pipeline.material_types import (
    MAX_GEMINI_FILE_BYTES,
    attached_materials,
    gemini_mime,
    needs_extraction,
)
from pipeline.strip_audio import strip_audio
from pipeline.summarize import (
    generate_assignment_doc,
    summarize,
    summarize_materials,
)
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

_locks: dict[
    tuple[str, str, str], asyncio.Lock
] = {}  # per-lecture; created lazily via setdefault
_in_flight: dict[
    str, dict
] = {}  # skey → entry; cleared at a pipeline's end (run_all: at the handover) or a lone step's
# run_all's finished lecture, left in _in_flight so /status never reads empty between lectures;
# the next step start replaces it in the same update, and run_all clears it when nothing does.
_handover: str | None = None
_errors: dict[
    str, dict
] = {}  # skey → last error record (see _error_record); survives after _in_flight clears
# The `scope` of notices.recent() that GET /status returns.
NOTICE_SCOPE = "pipeline"
_runner_status: dict = {"running": False, "total": 0, "done": 0, "last_error": None}
# Run-scoped; the {message, params} of Gemini's DAILY quota error that blocked summarize, reset
# by run_all. Every lecture it then stops carries the same facts as the one that hit the limit.
_summarize_block: dict | None = None
# Same shape for Groq's rate limit, which stops run_all before it transcribes further lectures.
_transcribe_block: dict | None = None

# The two codes a Gemini daily quota produces: the lecture that hit it, and every lecture run_all
# then stopped. Membership — not equality with one string — is what lifts the block on a retry.
_GEMINI_QUOTA_CODES = frozenset({"gemini_quota_exhausted", "gemini_quota_blocked"})
_GROQ_LIMIT_CODES = frozenset({"groq_rate_limited", "groq_rate_limit_blocked"})


# The steps that call Gemini, the only ones auto retry re-runs.
_GEMINI_STEPS = frozenset({"summarize", "intuition", "solution"})
# skey → the waiting retry: the lecture, the failed step, the `origin` to replay ("step" for a lone
# step, "pipeline" for a pipeline/queue run), its `attempt` number and the timer handle.
_retries: dict[str, dict] = {}
# skey → retries already fired for the failure being retried; kept while one runs, so the next
# failure knows which attempt it is. Cleared by success, a non-transient failure or a manual run.
_attempts: dict[str, int] = {}


class QueueEntry(NamedTuple):
    """One lecture waiting for the runner, and how far this trigger may take it."""

    course: str
    lecture: str
    kind: str
    depth: str  # "full" — every remaining step; "audio" — audio.mp3 and no further


_queue: list[
    QueueEntry
] = []  # drained in order by run_all; in memory only, a restart empties it

# Lectures whose lock only an auto-remove sweep holds, for one removal call: a trigger finding the
# lock held so waits for it instead of being refused or skipped (docs/PIPELINE.md, Auto-remove).
_removing: set[tuple[str, str, str]] = set()


def _lkey(course: str, lecture: str, kind: str) -> tuple[str, str, str]:
    """Tuple key into _locks — the dict holds Lock objects, not serialisable data."""

    return (course, lecture, kind)


def _skey(course: str, lecture: str, kind: str) -> str:
    """String key into _in_flight and _errors; appears verbatim in /status output."""

    return f"{course}||{lecture}||{kind}"


def _error_record(
    step: str,
    message: str,
    *,
    code: str | None = None,
    params: dict | None = None,
    blocked: bool = False,
) -> dict:
    """One /status error: the failed step, its machine code and named params beside the
    developer-facing message, `provider` for a Gemini quota or Groq rate limit, and `blocked`
    when run_all stopped this lecture on another's limit rather than it hitting one."""

    code = code or "unknown_error"
    return {
        "step": step,
        "message": message,
        "code": code,
        "params": params or {},
        "provider": "gemini"
        if code in _GEMINI_QUOTA_CODES
        else "groq"
        if code in _GROQ_LIMIT_CODES
        else None,
        "blocked": blocked,
    }


def _missing_prerequisite(message: str, file: str, step: str) -> dict:
    """An executor whose input file is not there yet — one code whichever step asked."""

    return {
        "status": "error",
        "message": message,
        "code": "missing_prerequisite",
        "params": {"file": file, "step": step},
    }


def _failed(exc: Exception) -> dict:
    """An executor's error result, carrying the exception's own code and params when it names
    itself; an untyped one falls back to `unknown_error` in `_error_record`."""

    result = {"status": "error", "message": str(exc)}
    fields = own_fields(exc)
    if fields:
        result["code"], result["params"] = fields
    return result


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_status() -> dict:
    """Snapshot of all live state; returned verbatim by GET /status."""

    return {
        "runner": dict(_runner_status),
        "in_flight": list(_in_flight.values()),
        "errors": dict(_errors),
        "queue": [entry._asdict() for entry in _queue],
        "overview_running": course_runner.active_courses(),
        "notices": notices.recent(NOTICE_SCOPE),
    }


async def prune_stale_errors() -> None:
    """Drop errors whose lecture no longer exists: a rename or delete never reaches the runner.
    Any existing lecture keeps its error whatever files it has, since a step may run off any of them."""

    if not _errors:
        return
    # A record written while the tree is fetched postdates it, so only earlier ones may go.
    before = dict(_errors)
    try:
        tree = await asyncio.to_thread(db_client.get_tree)
    except Exception:
        return  # database unreachable: keep what we have rather than lose real failures
    live = {
        _skey(c["name"], lec["name"], kind)
        for c in tree
        for kind, key in (("lecture", "lectures"), ("recitation", "recitations"))
        for lec in c.get(key) or []
    } | {
        _skey(c["name"], a["name"], "assignment")
        for c in tree
        for a in c.get("assignments") or []
    }
    for skey, record in before.items():
        if skey not in live and skey not in _in_flight and _errors.get(skey) is record:
            _drop_retry(skey)
            del _errors[skey]


# ---- Gemini auto retry (docs/PIPELINE.md#auto-retry) ----


def _drop_retry(skey: str) -> bool:
    """Forget a lecture's waiting retry and its attempt count, leaving its error; True iff one
    was waiting. Pings nothing: callers either notify or are about to."""

    _attempts.pop(skey, None)
    entry = _retries.pop(skey, None)
    if entry is None:
        return False
    entry["handle"].cancel()
    record = _errors.get(skey)
    if record is not None:
        record.pop("retry", None)
    return True


def cancel_retry(course: str, lecture: str, kind: str) -> bool:
    """Cancel the waiting retry of one lecture/assignment step; its error stays. False when none waits."""

    dropped = _drop_retry(_skey(course, lecture, kind))
    if dropped:
        db_client.notify()
    return dropped


def cancel_all_retries() -> None:
    """Drop every waiting retry, e.g. when the auto-retry switch goes off."""

    dropped = [_drop_retry(skey) for skey in list(_retries)]
    if any(dropped):
        db_client.notify()


def _schedule_retry(
    course: str, lecture: str, kind: str, step: str, origin: str
) -> None:
    """After a Gemini failure just recorded in _errors: arm the next retry if the failure is
    transient and the count is not spent, else forget the attempts."""

    skey = _skey(course, lecture, kind)
    record = _errors[skey]
    nxt = (
        auto_retry.next_retry(_attempts.get(skey, 0))
        if step in _GEMINI_STEPS
        and auto_retry.is_transient(record["code"], record["params"])
        else None
    )
    if nxt is None:
        _attempts.pop(skey, None)
        return
    field, delay = nxt
    _retries[skey] = {
        "course": course,
        "lecture": lecture,
        "kind": kind,
        "step": step,
        "origin": origin,
        "attempt": field["attempt"],
        "handle": asyncio.get_running_loop().call_later(delay, _fire_retry, skey),
    }
    record["retry"] = field


def _fire_retry(skey: str) -> None:
    """Timer callback: replay the original request through the normal entry point. A lecture
    that cannot start (busy, vanished from the queue's view) keeps its plain error."""

    entry = _retries.pop(skey, None)
    if entry is None:
        return
    course, lecture, kind = entry["course"], entry["lecture"], entry["kind"]
    record = _errors.get(skey)
    if record is None:  # the error was dropped (rename/delete): nothing to retry
        _attempts.pop(skey, None)
        db_client.notify()
        return
    _attempts[skey] = entry["attempt"]
    record.pop("retry", None)
    if entry["origin"] == "pipeline":
        started = enqueue(QueueEntry(course, lecture, kind, "full"), retry=True)
    elif kind == ASSIGNMENT_KIND:
        started = (
            try_run_assignment_step(course, lecture, entry["step"], retry=True)
            == "started"
        )
    else:
        started = (
            try_run_step(course, lecture, kind, entry["step"], retry=True) == "started"
        )
    if not started:
        _attempts.pop(skey, None)
        log.info(
            "%s/%s (%s): retry skipped, the lecture is busy", course, lecture, kind
        )
    db_client.notify()


# ---- empty-file guard ----

# A 0-byte pipeline file means the producing tool returned success with no content
# and raised nothing, so map each file to its likely cause for the error message.
EMPTY_FILE_ISSUES: dict[str, str] = {
    "video.mp4": "the source video is empty or was not fully uploaded",
    "audio.mp3": "ffmpeg produced no audio — the video may have no audio track or be corrupt",
    "transcript.txt": "Whisper returned no text — the audio may be silent or corrupt",
    "summary.md": "Gemini returned no text",
    "intuition.md": "Gemini returned no text",
    "solution.md": "Gemini returned no text",
    "summary.pdf": "pandoc produced an empty PDF — summary.md may be empty or malformed",
    "drive_url.txt": "the Drive upload returned no share URL",
}


def _require_nonempty(filename: str, data: bytes) -> None:
    """Reject a 0-byte pipeline file at every read and write — advancing on one
    (`next_step` counts it as "exists") surfaces a misleading downstream error."""

    if not data:
        hint = EMPTY_FILE_ISSUES.get(filename)
        # The hint is prose, so it rides the message only: `file` is what a renderer keys off.
        raise CodedError(
            f"{filename} is empty" + (f" — {hint}" if hint else ""),
            "empty_file",
            file=filename,
        )


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
            return _missing_prerequisite(
                "video.mp4 is required", "video.mp4", "download"
            )
        with _db_workspace(
            course, lecture, kind, download=["video.mp4"], upload=["audio.mp3"]
        ) as ws:
            strip_audio(str(ws["video.mp4"]), str(ws["audio.mp3"]))
        return {"status": "done"}
    except Exception as e:
        return _failed(e)


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
    A Groq 429 is an error flagged `groq_limit`, its partial transcript kept for the next run."""

    try:
        if not db_client.file_exists(course, lecture, kind, "audio.mp3"):
            return _missing_prerequisite(
                "audio.mp3 is required — run Extract Audio first", "audio.mp3", "audio"
            )

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
                return {**_failed(e), "groq_limit": True}
            except Exception as e:
                _persist_transcribe_partial(course, lecture, kind, Path(tmp))
                return _failed(e)

            transcript_bytes = transcript.encode("utf-8")
            _require_nonempty("transcript.txt", transcript_bytes)
            db_client.put_file_bytes(
                course, lecture, kind, "transcript.txt", transcript_bytes
            )
            db_client.delete_file(course, lecture, kind, PARTIAL_TXT)
            db_client.delete_file(course, lecture, kind, PARTIAL_META)
            return {"status": "done"}
    except Exception as e:
        return _failed(e)


def _display_name(entry: dict) -> str:
    return entry.get("filename") or entry["name"]


def _too_large(files: str, size: int) -> CodedError:
    limit_mb = MAX_GEMINI_FILE_BYTES // (1024 * 1024)
    return CodedError(
        f"attached materials over {limit_mb} MB: {files} — turn them off",
        "material_too_large",
        files=files,
        limit_mb=limit_mb,
        size_mb=round(size / (1024 * 1024), 1),
    )


def _check_sizes(entries: list[dict]) -> None:
    """Refuse a selection holding a file over Gemini's cap, before anything is downloaded.
    Office files are exempt: only their extracted text is sent, and `_prepare_material` caps that."""

    big = [
        e
        for e in entries
        if e.get("size", 0) > MAX_GEMINI_FILE_BYTES and not needs_extraction(e["name"])
    ]
    if big:
        raise _too_large(
            ", ".join(_display_name(e) for e in big), max(e["size"] for e in big)
        )


def _prepare_material(
    dest: Path, name: str, data: bytes, label: str, display: str | None = None
) -> Path | None:
    """Write one material into `dest` as the file to send: an Office file as its extracted text,
    refused `material_too_large` past the cap. None, with a log line naming `label`, for an empty or unreadable one."""

    if not data:
        log.warning("%s: skipping empty material %s", label, name)
        return None
    path = dest / name
    path.write_bytes(data)
    if needs_extraction(name):
        try:
            text = extract_text(path, name.rsplit(".", 1)[-1].lower())
        except Exception as e:
            log.warning("%s: skipping unreadable material %s: %s", label, name, e)
            return None
        if not text.strip():
            log.warning("%s: skipping material %s with no text", label, name)
            return None
        encoded = text.encode("utf-8")
        if len(encoded) > MAX_GEMINI_FILE_BYTES:
            raise _too_large(display or name, len(encoded))
        path = dest / f"{name}.txt"
        path.write_bytes(encoded)
    return path


def _download_materials(
    course: str, lecture: str, kind: str, dest: Path, entries: list[dict] | None = None
) -> list[tuple[str, Path]]:
    """Fetch the attached materials (or the given selection) into `dest` as (name, file to send);
    an Office file is sent as extracted text. An empty or unreadable one is skipped, not fatal."""

    if entries is None:
        entries = attached_materials(db_client.list_materials(course, lecture, kind))
    sent: list[tuple[str, Path]] = []
    for entry in entries:
        name = entry["name"]
        data = db_client.get_file_bytes(course, lecture, kind, name)
        path = _prepare_material(
            dest, name, data, f"{course}/{lecture} ({kind})", _display_name(entry)
        )
        if path is not None:
            sent.append((name, path))
    return sent


def _summarize_from_materials(
    course: str, lecture: str, kind: str, entries: list[dict]
) -> tuple[str, list[str]]:
    """Summarize a materials-only lecture from its attached files alone; every one empty is a
    step error. Returns the summary and the names sent."""

    with tempfile.TemporaryDirectory() as tmp:
        sent = _download_materials(course, lecture, kind, Path(tmp), entries)
        if not sent:
            raise CodedError("every attached material is empty", "materials_empty")
        log.info("Summarize: no transcript — %d materials only", len(sent))
        return summarize_materials([p for _, p in sent]), [n for n, _ in sent]


def _summarize_source(course: str, lecture: str, kind: str) -> list[dict] | None:
    """The single summarize readiness rule: [] for the transcript path, the attached material
    listing for a lecture with no video.mp4/audio.mp3, or None when there is no input yet."""

    if db_client.file_exists(course, lecture, kind, "transcript.txt"):
        return []
    if db_client.file_exists(
        course, lecture, kind, "video.mp4"
    ) or db_client.file_exists(course, lecture, kind, "audio.mp3"):
        return None
    return attached_materials(db_client.list_materials(course, lecture, kind)) or None


def _record_used_materials(course: str, lecture: str, kind: str, names: list[str]):
    """Record the attached selection (skipped files included, so it matches what the UI has
    attached). Best-effort: the summary is already written, so a failed record never fails the run."""

    try:
        db_client.put_summary_materials(course, lecture, kind, names)
    except Exception as e:
        log.warning(
            "%s/%s (%s): could not record summary materials: %s",
            course,
            lecture,
            kind,
            e,
        )


def _exec_summarize(course: str, lecture: str, kind: str) -> dict:
    """Summarize transcript.txt → summary.md via Gemini, passing every attached material;
    a materials-only lecture summarizes from them alone. A daily Gemini 429 is flagged."""

    try:
        entries = _summarize_source(course, lecture, kind)
        if entries is None:
            return _missing_prerequisite(
                "transcript.txt is required — run Transcribe first",
                "transcript.txt",
                "transcribe",
            )
        if entries:
            _check_sizes(entries)
            summary, used = _summarize_from_materials(course, lecture, kind, entries)
            recorded = [e["name"] for e in entries]
            # A video that landed mid-summarize supersedes the materials: write nothing and fail,
            # so the run stops and the video path (transcribe) is what runs next.
            if db_client.file_exists(course, lecture, kind, "video.mp4"):
                log.info(
                    "Summarize: video arrived mid-run — discarding materials summary"
                )
                return _missing_prerequisite(
                    "video.mp4 arrived during summarize — run Transcribe first",
                    "transcript.txt",
                    "transcribe",
                )
        else:
            selected = attached_materials(
                db_client.list_materials(course, lecture, kind)
            )
            _check_sizes(selected)
            with _db_workspace(
                course, lecture, kind, download=["transcript.txt"]
            ) as ws:
                transcript = ws["transcript.txt"]
                sent = _download_materials(
                    course, lecture, kind, transcript.parent, selected
                )
                log.info(
                    "Summarize: %s",
                    f"{len(sent)} materials found — passing to Gemini"
                    if sent
                    else "no materials found — transcript only",
                )
                summary = summarize(transcript, [p for _, p in sent])
                used = [n for n, _ in sent]
                recorded = [e["name"] for e in selected]
        # Gemini can return HTTP 200 with no text (e.g. finish_reason MALFORMED_RESPONSE).
        _require_nonempty("summary.md", summary.encode("utf-8"))
        db_client.put_summary(course, lecture, kind, summary, fresh=True)
        _record_used_materials(course, lecture, kind, recorded)
        return {"status": "done", "usedMaterial": bool(used)}
    except GeminiRateLimitError as e:
        return {**_failed(e), "daily_quota": e.info["is_daily"]}
    except Exception as e:
        return _failed(e)


def _drop_marker(course: str, lecture: str, kind: str, name: str) -> None:
    """Best-effort delete of a render marker: it runs after the render's real outcome is
    already persisted, so a failing cleanup call must not restate that outcome."""

    try:
        db_client.delete_file(course, lecture, kind, name)
    except Exception:
        log.exception("failed to delete %s", name)


def _exec_pdf(course: str, lecture: str, kind: str, *, fresh: bool = False) -> dict:
    """Render summary.md → summary.pdf via pandoc/tectonic. A render that errored but still
    produced a usable PDF is `done` with the warning persisted to .pdf_warning."""

    try:
        if not db_client.file_exists(course, lecture, kind, "summary.md"):
            return _missing_prerequisite(
                "summary.md is required — run Summarize first",
                "summary.md",
                "summarize",
            )
        if fresh:
            # A PDF the database cannot delete (a viewer holds it) is one the upload cannot
            # overwrite either, so fail with its code before the render rather than after.
            db_client.delete_file(course, lecture, kind, "summary.pdf")
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
        # Any old summary.pdf survives, but overwriting the .tex just invalidated its
        # warning's `l.<N>`. Only that overwrite does — otherwise the old pair still agrees.
        if stored_tex:
            _drop_marker(course, lecture, kind, PDF_WARNING_FILE)
        return _failed(e)
    except Exception as e:
        return _failed(e)


def _exec_drive(course: str, lecture: str, kind: str) -> dict:
    """Upload summary.pdf to Google Drive and write the share URL to drive_url.txt."""

    try:
        if not db_client.file_exists(course, lecture, kind, "summary.pdf"):
            return _missing_prerequisite(
                "summary.pdf is required — run PDF first", "summary.pdf", "pdf"
            )
        # Checked before the workspace download: an unconnected Drive fails every queued
        # lecture, and each one would otherwise fetch its PDF first.
        google_auth.get_credentials("drive")
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
        return _failed(e)


# ---- Assignment docs ----

ASSIGNMENT_KIND = "assignment"
_NOT_THERE = ("file_not_found", "lecture_not_found")


def _assignment_inputs(
    course: str, entry: dict, dest: Path
) -> tuple[list[tuple[Path, str]], list[tuple[str, str, str]]]:
    """What Gemini gets for one assignment: supported attached files as (path, mime) and each chosen
    lecture's summary as (kind, name, text); gone or summary-less lectures are skipped, none left is `assignment_inputs_empty`."""

    name = entry["name"]
    chosen = [
        f
        for f in entry.get("files") or []
        if f.get("attach", True) and gemini_mime(f["name"])
    ]
    _check_sizes(chosen)
    files: list[tuple[Path, str]] = []
    for f in chosen:
        data = db_client.get_assignment_file_bytes(course, name, f["name"])
        path = _prepare_material(
            dest, f["name"], data, f"{course}/{name} (assignment)", _display_name(f)
        )
        if path is not None:
            files.append((path, gemini_mime(path.name)))
    summaries: list[tuple[str, str, str]] = []
    for lec in entry.get("lectures") or []:
        try:
            text = db_client.get_summary(course, lec["name"], lec["kind"])
        except db_client.DbClientError as e:
            if e.code not in _NOT_THERE:
                raise
            text = ""
        if not text.strip():
            log.info(
                "%s/%s (assignment): skipping %s %s, it has no summary",
                course,
                name,
                lec["kind"],
                lec["name"],
            )
            continue
        summaries.append((lec["kind"], lec["name"], text))
    if not files and not summaries:
        raise CodedError(
            "no attached file and no lecture summary to send", "assignment_inputs_empty"
        )
    return files, summaries


def _exec_assignment_doc(course: str, assignment: str, *, doc: str, **_opts) -> dict:
    """Generate `{doc}.md` from the assignment's inputs with Gemini, then render its PDF. `fresh`
    (in `_opts`) is ignored: the markdown is always new AI output. A quota hit is a plain error, never a block."""

    try:
        entry = db_client.get_assignment(course, assignment)
        with tempfile.TemporaryDirectory() as tmp:
            files, summaries = _assignment_inputs(course, entry, Path(tmp))
            text = generate_assignment_doc(doc, files, summaries)
        # Gemini can return HTTP 200 with no text.
        _require_nonempty(f"{doc}.md", text.encode("utf-8"))
        db_client.put_assignment_doc(course, assignment, doc, text, fresh=True)
    except Exception as e:
        return _failed(e)
    return _exec_assignment_pdf(course, assignment, doc=doc)


def _drop_generated(course: str, assignment: str, name: str) -> None:
    """`_drop_marker` for a `.generated/` file."""

    try:
        db_client.delete_generated(course, assignment, name)
    except Exception:
        log.exception("failed to delete %s", name)


def _exec_assignment_pdf(
    course: str, assignment: str, *, doc: str, fresh: bool = False
) -> dict:
    """Render `{doc}.md` → `{doc}.pdf` like `_exec_pdf`, keeping its warning and build-tex markers
    in `.generated/`."""

    pdf, warning_name, tex_name = (
        f"{doc}.pdf",
        f"{doc}.pdf_warning",
        f"{doc}.pdf_build.tex",
    )
    try:
        try:
            md = db_client.get_assignment_doc(course, assignment, doc)
        except db_client.DbClientError as e:
            if e.code != "file_not_found":
                raise
            return _missing_prerequisite(
                f"{doc}.md is required — generate it first", f"{doc}.md", doc
            )
        _require_nonempty(f"{doc}.md", md.encode("utf-8"))
        if fresh:
            db_client.delete_generated(course, assignment, pdf)
        with tempfile.TemporaryDirectory() as tmp:
            md_path = Path(tmp) / f"{doc}.md"
            md_path.write_text(md, encoding="utf-8")
            pdf_path, warning = convert_to_pdf(str(md_path))
            data = Path(pdf_path).read_bytes()
        _require_nonempty(pdf, data)
        db_client.put_generated(course, assignment, pdf, data)
        if warning:
            db_client.put_generated(
                course, assignment, warning_name, warning.encode("utf-8")
            )
        else:
            _drop_generated(course, assignment, warning_name)
        _drop_generated(course, assignment, tex_name)
        db_client.notify()
        return {"status": "done"}
    except PdfRenderError as e:
        stored_tex = False
        if e.tex_source:
            try:
                db_client.put_generated(
                    course, assignment, tex_name, e.tex_source.encode("utf-8")
                )
                stored_tex = True
            except Exception:
                log.exception("failed to store %s", tex_name)
        if stored_tex:
            _drop_generated(course, assignment, warning_name)
        return _failed(e)
    except Exception as e:
        return _failed(e)


_ASSIGNMENT_EXECUTORS = {
    "intuition": partial(_exec_assignment_doc, doc="intuition"),
    "solution": partial(_exec_assignment_doc, doc="solution"),
    "intuition_pdf": partial(_exec_assignment_pdf, doc="intuition"),
    "solution_pdf": partial(_exec_assignment_pdf, doc="solution"),
}


_EXECUTORS = {
    "audio": _exec_audio,
    "transcribe": _exec_transcribe,
    "summarize": _exec_summarize,
    "pdf": _exec_pdf,
    "drive": _exec_drive,
}


def execute_step(course: str, lecture: str, kind: str, step: str) -> dict:
    """Public dispatch: called by backend_main.py route handlers."""

    return _EXECUTORS[step](course, lecture, kind)


# ---- Pipeline utilities ----


def enabled_steps() -> list[str]:
    """STEP_ORDER minus the steps their setting switches off. Read at call time, so
    POST /config flips a step for the running process."""

    if settings.drive_enabled():
        return list(STEP_ORDER)
    return [step for step in STEP_ORDER if step != "drive"]


def final_output() -> str:
    """The file that marks a lecture complete — drive_url.txt, or summary.pdf with Drive
    off. Completion stays pure file existence, so there is no marker file to keep in sync."""

    return STEP_OUTPUT[enabled_steps()[-1]]


def _has(files: dict, name: str) -> bool:
    entry = files.get(name)
    return bool(entry and entry.get("exists"))


def _present(files: dict, name: str) -> bool:
    """On disk, or reported removed by the tree: either way the step that produces it is done."""

    entry = files.get(name)
    return bool(entry and (entry.get("exists") or entry.get("removed")))


def _mark_removed(files: dict, removed: list[str]) -> dict:
    """Flag the names the tree's `removed` reports (absent, later artifact on disk) on a files map."""

    marked = dict(files)
    for name in removed:
        marked[name] = {**(marked.get(name) or {"exists": False}), "removed": True}
    return marked


def is_materials_only(files: dict, materials: list) -> bool:
    """A lecture with attached materials and no video.mp4 or audio.mp3, neither removed —
    summarized from the materials alone."""

    return (
        not _present(files, "video.mp4")
        and not _present(files, "audio.mp3")
        and bool(attached_materials(materials))
    )


def next_step(files: dict, materials_only: bool = False) -> Optional[str]:
    """The first enabled step whose output file is missing, or None once the final output
    exists; a materials-only lecture skips audio and transcribe. A removed output counts."""

    if _has(files, final_output()):
        return None
    for step in enabled_steps():
        if materials_only and step in ("audio", "transcribe"):
            continue
        if not _present(files, STEP_OUTPUT[step]):
            return step
    return None


def summarize_ready(course: str, lecture: str, kind: str) -> bool:
    """True when summarize has an input — see _summarize_source."""

    return _summarize_source(course, lecture, kind) is not None


def _lecture_pending(files: dict) -> bool:
    """A lecture is pending iff it has video.mp4 (or removed it) but not the final output."""

    return _present(files, "video.mp4") and not _has(files, final_output())


async def scan_pending() -> list[tuple[str, str, str]]:
    """Walk the full tree for every pending lecture/recitation as (course, lecture, kind)."""

    tree = await asyncio.to_thread(db_client.get_tree)
    pending: list[tuple[str, str, str]] = []
    for course in tree:
        course_name = course["name"]
        for kind, key in (("lecture", "lectures"), ("recitation", "recitations")):
            for lec in course.get(key) or []:
                files = _mark_removed(lec.get("files") or {}, lec.get("removed") or [])
                if _lecture_pending(files):
                    pending.append((course_name, lec["name"], kind))
    return pending


def _busy(key: tuple[str, str, str]) -> bool:
    """True when a run owns this lecture's lock; a sweep's removal holding it does not count."""

    lock = _locks.get(key)
    return lock is not None and lock.locked() and key not in _removing


def _claim(key: tuple[str, str, str]) -> bool:
    """Take a lecture for a run about to wait on its lock: False when busy, else True, and from
    here on a second trigger finds it busy even while a sweep's removal still holds the lock."""

    if _busy(key):
        return False
    _removing.discard(key)
    return True


def enqueue(entry: QueueEntry, *, retry: bool = False) -> bool:
    """Add one lecture to the runner queue, starting the run when it is idle. False when the
    lecture is already queued, in flight, or owned by a concurrent trigger — nothing to add.
    Anything but the lecture's own auto retry supersedes a retry waiting for it."""

    if any(q[:3] == entry[:3] for q in _queue):
        return False
    if _skey(entry.course, entry.lecture, entry.kind) in _in_flight:
        return False
    if _busy(_lkey(entry.course, entry.lecture, entry.kind)):
        return False
    if not retry:
        _drop_retry(_skey(entry.course, entry.lecture, entry.kind))
    _queue.append(entry)
    if not _runner_status["running"]:
        # Flipped here rather than in run_all: the task only starts at the next await, so a burst
        # of arrivals in one callback would otherwise each start a drain of their own.
        # Counters reset here too, so a snapshot taken before the task starts is not last run's.
        _runner_status.update(running=True, done=0, total=1, last_error=None)
        asyncio.create_task(run_all())
    else:
        # Counted now, so "lecture N of M" grows the moment a lecture joins a live run.
        _runner_status["total"] += 1
    return True


def enqueue_arrival(course: str, lecture: str, kind: str) -> str:
    """Act on a video that just landed on disk. AUTO_RUN is the ceiling: `off` drops the arrival,
    `audio` stops at audio.mp3, `full` runs the whole pipeline."""

    depth = settings.auto_run()
    if depth == "off":
        log.info(
            "video arrived for %s/%s (%s): AUTO_RUN=off, queuing nothing",
            course,
            lecture,
            kind,
        )
        return "off"
    if not enqueue(QueueEntry(course, lecture, kind, depth)):
        return "busy"
    db_client.notify()
    return "queued"


def clear_provider_blocks() -> None:
    """Lift the run-scoped Gemini and Groq blocks so a user's run-all retries the provider — the
    user may have swapped keys since the block was set. Never called for an automatic arrival."""

    global _summarize_block, _transcribe_block
    _summarize_block = None
    _transcribe_block = None


def move_to_front(course: str, lecture: str, kind: str) -> str:
    """Make a queued lecture the runner's next one, keeping its entry and depth. Returns 'moved',
    or 'not_queued' when it is not waiting in the queue (in flight counts as not queued)."""

    index = next(
        (i for i, q in enumerate(_queue) if q[:3] == (course, lecture, kind)), None
    )
    if index is None:
        return "not_queued"
    if index > 0:
        _queue.insert(0, _queue.pop(index))
        db_client.notify()
    return "moved"


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
    files = {
        name: {"exists": exists} for name, exists in zip(names, results, strict=True)
    }
    if not results[1] and results[2]:
        # The one case where the tree's `removed` is non-empty: audio gone, transcript kept.
        removed = await asyncio.to_thread(_removed_names, course, lecture, kind)
        files = _mark_removed(files, removed)
    return files


def _removed_names(course: str, lecture: str, kind: str) -> list[str]:
    """The intermediates the tree reports removed from one lecture."""

    key = "recitations" if kind == "recitation" else "lectures"
    for node in db_client.get_tree():
        if node.get("name") == course:
            for lec in node.get(key) or []:
                if lec.get("name") == lecture:
                    return lec.get("removed") or []
    return []


# ---- Async step/pipeline runners ----


def _drop_handover() -> bool:
    """Clear run_all's held finished lecture out of _in_flight; True iff an entry was removed."""

    global _handover
    key, _handover = _handover, None
    return key is not None and _in_flight.pop(key, None) is not None


def _with_notices(fn, course: str, lecture: str, kind: str, *args, **opts) -> dict:
    """Run an executor in a worker thread with Gemini model fallbacks noticed for this lecture."""

    with notices.record_fallbacks(
        NOTICE_SCOPE, course=course, lecture=lecture, kind=kind
    ):
        return fn(course, lecture, *args, **opts)


async def _call_step(
    course: str, lecture: str, kind: str, step: str, *, fresh: bool = False
) -> dict:
    """Run one executor in a worker thread so the event loop stays free during blocking I/O."""

    opts = {"fresh": True} if fresh else {}
    if kind == ASSIGNMENT_KIND:
        return await asyncio.to_thread(
            _with_notices,
            _ASSIGNMENT_EXECUTORS[step],
            course,
            lecture,
            kind,
            **opts,
        )
    return await asyncio.to_thread(
        _with_notices, _EXECUTORS[step], course, lecture, kind, kind, **opts
    )


async def _run_step_unlocked(
    course: str,
    lecture: str,
    kind: str,
    step: str,
    *,
    keep_in_flight: bool = False,
    fresh: bool = False,
    origin: str = "step",
) -> None:
    """Run one step once, to done or a recorded error. Unsafe: the caller must hold this
    lecture's lock; keep_in_flight leaves the end-of-step clear to it. `origin` is the request a
    transient Gemini failure's auto retry replays: a lone "step" or the whole "pipeline"."""

    global _summarize_block, _transcribe_block
    skey = _skey(course, lecture, kind)
    _drop_handover()  # the held lecture leaves in the same notify this one arrives in
    _in_flight[skey] = {
        "course": course,
        "lecture": lecture,
        "kind": kind,
        "step": step,
        "started_at": _now_iso(),
    }
    _errors.pop(skey, None)  # clear any stale error from a previous attempt
    if step == "summarize":
        # Any summarize attempt re-tests Gemini's quota: drop every quota record and lift the
        # run's stop, so lectures still queued retry; a fresh hit re-sets both below. A record
        # with a waiting retry stays, so its countdown and cancel remain visible.
        for key in [
            k
            for k, e in _errors.items()
            if e["code"] in _GEMINI_QUOTA_CODES and "retry" not in e
        ]:
            del _errors[key]
        _summarize_block = None
    elif step == "transcribe":
        # Likewise for Groq: a transcribe attempt re-tests the rate limit.
        for key in [k for k, e in _errors.items() if e["code"] in _GROQ_LIMIT_CODES]:
            del _errors[key]
        _transcribe_block = None
    db_client.notify()

    result = await _call_step(course, lecture, kind, step, fresh=fresh)

    if result["status"] == "done":
        _attempts.pop(skey, None)
        if not keep_in_flight:
            _in_flight.pop(skey, None)
            db_client.notify()
        return
    else:  # error
        msg = result.get("message") or result.get("status") or "unknown error"
        params = result.get("params") or {}
        # Belt and braces: an assignment run is manual, so no run-all waits on its quota.
        if result.get("daily_quota") and kind != ASSIGNMENT_KIND:
            _summarize_block = {"message": msg, "params": params}
        if result.get("groq_limit"):
            _transcribe_block = {"message": msg, "params": params}
        _errors[skey] = _error_record(step, msg, code=result.get("code"), params=params)
        # ERROR becomes a Sentry event; a provider's availability or the user's setup is not ours to report.
        level = (
            logging.WARNING if result.get("code") in CONDITION_CODES else logging.ERROR
        )
        # One Sentry issue per (step, code): the shared template alone would merge every failure.
        with sentry_sdk.new_scope() as scope:
            scope.fingerprint = ["pipeline-step-failed", step, _errors[skey]["code"]]
            log.log(
                level, "%s/%s (%s) step %s failed: %s", course, lecture, kind, step, msg
            )
        _schedule_retry(course, lecture, kind, step, origin)
        if not keep_in_flight:
            _in_flight.pop(skey, None)
            db_client.notify()
        return


async def _run_pipeline_unlocked(
    course: str,
    lecture: str,
    kind: str,
    *,
    honor_block: bool = False,
    hand_over: bool = False,
) -> bool:
    """Advance a lecture through its remaining steps; True iff it stopped early on the
    run-scoped summarize or transcribe block. Unsafe: the caller must hold this lecture's lock."""

    global _handover
    skey = _skey(course, lecture, kind)
    held = False
    # The lecture stays in _in_flight from its first step to here, so /status never shows
    # it idle between steps; this finally clears it unless hand_over leaves it to the next one.
    try:
        while True:
            files = await _fetch_files(course, lecture, kind)
            materials_only = False
            if not _present(files, "video.mp4") and not _present(files, "audio.mp3"):
                materials = await asyncio.to_thread(
                    db_client.list_materials, course, lecture, kind
                )
                materials_only = is_materials_only(files, materials)
            step = next_step(files, materials_only)
            if step is None:
                held = hand_over and skey in _in_flight
                if held:
                    _handover = skey
                return False
            block = {
                "summarize": _summarize_block,
                "transcribe": _transcribe_block,
            }.get(step)
            if honor_block and block is not None:
                # Same record as the lecture that hit the limit, so this one doesn't look pending.
                _errors[skey] = _error_record(
                    step,
                    block["message"],
                    code="gemini_quota_blocked"
                    if step == "summarize"
                    else "groq_rate_limit_blocked",
                    params=block["params"],
                    blocked=True,
                )
                _drop_handover()
                _in_flight.pop(skey, None)
                db_client.notify()
                log.info(
                    "%s/%s (%s): %s blocked (%s), stopping here",
                    course,
                    lecture,
                    kind,
                    step,
                    "Gemini daily quota" if step == "summarize" else "Groq rate limit",
                )
                return True
            await _run_step_unlocked(
                course, lecture, kind, step, keep_in_flight=True, origin="pipeline"
            )
            if skey in _errors:
                return False  # a step error halts the whole pipeline for this lecture
    finally:
        # No notify when nothing ran: run_all's per-lecture pings must not burst (PIPELINE.md).
        if not held and _in_flight.pop(skey, None) is not None:
            db_client.notify()


async def run_step(
    course: str, lecture: str, kind: str, step: str, *, fresh: bool = False
) -> None:
    """Acquire the per-lecture lock, then run one step to completion (blocking the caller).
    `fresh` (pdf only) deletes the old summary.pdf under the lock before the render."""

    async with _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock()):
        await _run_step_unlocked(course, lecture, kind, step, fresh=fresh)
        if kind != ASSIGNMENT_KIND:
            await asyncio.to_thread(auto_remove, course, lecture, kind)


async def run_pipeline_for(
    course: str,
    lecture: str,
    kind: str,
    *,
    honor_block: bool = False,
    hand_over: bool = False,
) -> bool:
    """Acquire the per-lecture lock, then advance the lecture through all remaining steps.
    Returns True iff it stopped early on a run-scoped block (run_all only)."""

    async with _locks.setdefault(_lkey(course, lecture, kind), asyncio.Lock()):
        blocked = await _run_pipeline_unlocked(
            course, lecture, kind, honor_block=honor_block, hand_over=hand_over
        )
        await asyncio.to_thread(auto_remove, course, lecture, kind)
        return blocked


def try_run_step(
    course: str,
    lecture: str,
    kind: str,
    step: str,
    *,
    fresh: bool = False,
    retry: bool = False,
) -> str:
    """Fire-and-forget run_step if the lecture isn't already locked, pulling it out of the
    runner queue. Returns 'busy' or 'started'; 'busy' touches no file. A manual run supersedes
    the lecture's waiting auto retry."""

    if not _claim(_lkey(course, lecture, kind)):
        return "busy"
    if not retry:
        _drop_retry(_skey(course, lecture, kind))
    _queue[:] = [q for q in _queue if q[:3] != (course, lecture, kind)]
    asyncio.create_task(run_step(course, lecture, kind, step, fresh=fresh))
    return "started"


def try_run_assignment_step(
    course: str,
    assignment: str,
    step: str,
    *,
    fresh: bool = False,
    retry: bool = False,
) -> str:
    """Fire-and-forget one assignment step if its lock is free. Returns 'busy' or 'started'; it
    never joins the runner queue, and no run-all or AUTO_RUN pass starts one."""

    key = _lkey(course, assignment, ASSIGNMENT_KIND)
    if not _claim(key):
        return "busy"
    if not retry:
        _drop_retry(_skey(course, assignment, ASSIGNMENT_KIND))
    asyncio.create_task(
        run_step(course, assignment, ASSIGNMENT_KIND, step, fresh=fresh)
    )
    return "started"


def try_run_pipeline(course: str, lecture: str, kind: str) -> str:
    """Fire-and-forget run_pipeline_for if the lecture isn't already locked, pulling it out of
    the runner queue. Returns 'busy' or 'started'. Supersedes the lecture's waiting auto retry."""

    if not _claim(_lkey(course, lecture, kind)):
        return "busy"
    _drop_retry(_skey(course, lecture, kind))
    _queue[:] = [q for q in _queue if q[:3] != (course, lecture, kind)]
    asyncio.create_task(run_pipeline_for(course, lecture, kind))
    return "started"


# ---- Auto-remove ----

_REMOVE_TARGETS = {"video": ["video.mp4"], "audio": ["video.mp4", "audio.mp3"]}
_REMOVE_CONDITION = {"pdf": "summary.pdf", "drive": "drive_url.txt"}


def _remove_rule() -> tuple[list[str], str] | None:
    """The live rule as (files it deletes, output that must exist), or None when it removes nothing.
    `drive` with Drive switched off removes nothing: drive_url.txt can never arrive to justify it."""

    mode, after = settings.auto_remove(), settings.auto_remove_after()
    if mode == "off" or after is None:
        return None
    if after == "drive" and not settings.drive_enabled():
        return None
    return _REMOVE_TARGETS[mode], _REMOVE_CONDITION[after]


def removal_targets(files: dict) -> list[str]:
    """The files the live rule deletes from a lecture with this files map: those on disk, once
    the rule's output exists."""

    rule = _remove_rule()
    if rule is None:
        return []
    targets, condition = rule
    if not _has(files, condition):
        return []
    return [name for name in targets if _has(files, name)]


def auto_remove(course: str, lecture: str, kind: str) -> str:
    """Apply the live rule to one lecture; the caller holds its lock. Returns removed, none, locked
    or failed and never raises: a failed removal is a warning, never the run's outcome."""

    rule = _remove_rule()
    if rule is None:
        return "none"
    targets, condition = rule
    try:
        files = {
            name: {"exists": db_client.file_exists(course, lecture, kind, name)}
            for name in [condition, *targets]
        }
        names = removal_targets(files)
        if not names:
            return "none"
        db_client.remove_files(course, lecture, kind, names)
    except Exception as e:
        locked = isinstance(e, db_client.DbClientError) and e.code == "file_locked"
        log.warning(
            "%s/%s (%s): auto-remove %s: %s",
            course,
            lecture,
            kind,
            "skipped, a file is open elsewhere" if locked else "failed",
            e,
        )
        return "locked" if locked else "failed"
    log.info("%s/%s (%s): auto-removed %s", course, lecture, kind, ", ".join(names))
    return "removed"


async def apply_auto_remove() -> dict:
    """Apply the live rule to every lecture and recitation in the tree, archived courses included.
    A lecture mid-run is deferred: the hook at the end of its run applies the rule then."""

    counts = {"removed": 0, "locked": 0, "deferred": 0, "failed": 0}
    if _remove_rule() is None:
        return counts
    tree = await asyncio.to_thread(db_client.get_tree)
    for node in tree:
        for kind, key in (("lecture", "lectures"), ("recitation", "recitations")):
            for lec in node.get(key) or []:
                if not removal_targets(lec.get("files") or {}):
                    continue
                lkey = _lkey(node["name"], lec["name"], kind)
                lock = _locks.setdefault(lkey, asyncio.Lock())
                if lock.locked():
                    counts["deferred"] += 1
                    continue
                # A free lock is taken without yielding, so nothing starts in between; _removing
                # makes every trigger that arrives meanwhile wait behind it rather than skip it.
                async with lock:
                    _removing.add(lkey)
                    try:
                        outcome = await asyncio.to_thread(
                            auto_remove, node["name"], lec["name"], kind
                        )
                    finally:
                        _removing.discard(lkey)
                if outcome in counts:
                    counts[outcome] += 1
    return counts


# ---- Runner orchestration ----


async def _run_entry(entry: QueueEntry) -> bool:
    """Run one queue entry as far as its depth allows; True iff a full run stopped early on the
    run-scoped block. An `audio` entry whose audio.mp3 exists or was removed has nothing left."""

    if entry.depth == "audio":
        files = await _fetch_files(entry.course, entry.lecture, entry.kind)
        if not _present(files, STEP_OUTPUT["audio"]):
            await run_step(entry.course, entry.lecture, entry.kind, "audio")
        return False
    return await run_pipeline_for(
        entry.course, entry.lecture, entry.kind, honor_block=True, hand_over=True
    )


async def run_all() -> dict:
    """Drain the runner queue sequentially until it is empty, so a lecture enqueued mid-run joins
    this run instead of racing it. The caller enqueues; this never re-scans."""

    global _summarize_block, _transcribe_block
    log.info(
        "run_all starting with %d queued lecture(s): %s",
        len(_queue),
        ", ".join(f"{e.course}/{e.lecture} ({e.kind}, {e.depth})" for e in _queue),
    )
    _summarize_block = None
    _transcribe_block = None
    blocked_count = 0
    _runner_status["running"] = True
    _runner_status["done"] = 0
    _runner_status["total"] = len(_queue)
    _runner_status["last_error"] = None
    # No notify: with _in_flight still empty these burst, and their parallel refreshes
    # can reorder and overwrite the fresher snapshot. Same for the per-lecture done below.
    try:
        while _queue:
            # Recomputed before the pop, so a lecture a manual run pulled out stops being counted.
            _runner_status["total"] = _runner_status["done"] + len(_queue)
            entry = _queue.pop(0)
            course, lecture, kind = entry.course, entry.lecture, entry.kind
            log.info(
                "=== starting pipeline %d/%d: %s/%s (%s) at depth %s ===",
                _runner_status["done"] + 1,
                _runner_status["total"],
                course,
                lecture,
                kind,
                entry.depth,
            )
            if not _claim(_lkey(course, lecture, kind)):
                # Skip if a concurrent trigger (e.g. a manual step run) already owns this lecture.
                log.info(
                    "lecture %s/%s (%s) already in flight, skipping",
                    course,
                    lecture,
                    kind,
                )
                _drop_handover()
                _runner_status["done"] += 1
                db_client.notify()
                continue
            try:
                if await _run_entry(entry):
                    blocked_count += 1
            except Exception as e:
                log.exception("pipeline crashed for %s/%s: %s", course, lecture, e)
                # The crash is logged in full above; a blocked app file hides its OS text.
                code, params = (
                    ("app_files_blocked", {})
                    if app_files_blocked(e)
                    else (
                        "run_crashed",
                        {"course": course, "lecture": lecture, "detail": str(e)},
                    )
                )
                _runner_status["last_error"] = {
                    "message": f"{course}/{lecture}: {e}",
                    "code": code,
                    "params": params,
                }
            _runner_status["done"] += 1
            # An entry that started no step left the previous lecture held: clear it now.
            if _handover != _skey(course, lecture, kind) and _drop_handover():
                db_client.notify()
        blocked = (
            f", {blocked_count} stopped on a Gemini daily quota or Groq rate limit"
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
        _summarize_block = None
        _transcribe_block = None
        _drop_handover()
        db_client.notify()
