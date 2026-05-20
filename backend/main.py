import asyncio
import json
import os
import tempfile
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from services import db_client
from pipeline.strip_audio import strip_audio
from pipeline.transcribe import transcribe_audio, TranscribeRateLimitError, PARTIAL_TXT, PARTIAL_META
from pipeline.summarize import summarize
from pipeline.to_pdf import convert_to_pdf
from pipeline.upload_to_drive import upload_to_drive
from timing import init_db, get_stats
import resume as resume_module

load_dotenv()

RECITATIONS_DIR = "Recitations"


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()
    scheduler.add_job(resume_module._scheduled_resume, CronTrigger(hour=3, minute=0), id="resume_all_daily")
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
    if kind not in {"lecture", "recitation"}:
        return {"status": "error", "message": f"invalid kind: {kind}"}
    return None


@contextmanager
def db_workspace(course: str, lecture: str, kind: str, *, download=(), upload=()):
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


@app.post("/courses/{course}/lectures/{lecture}/run/audio")
def run_audio(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    try:
        if not db_client.file_exists(course, lecture, kind, "video.mp4"):
            return {"status": "error", "message": "video.mp4 is required"}
        with db_workspace(course, lecture, kind, download=["video.mp4"], upload=["audio.mp3"]) as ws:
            strip_audio(str(ws["video.mp4"]), str(ws["audio.mp3"]))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/transcribe")
def run_transcribe(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
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
                # Persist partial state so the next call can resume.
                partial_txt = Path(tmp) / PARTIAL_TXT
                partial_meta = Path(tmp) / PARTIAL_META
                if partial_txt.exists():
                    db_client.put_file_bytes(course, lecture, kind, PARTIAL_TXT, partial_txt.read_bytes())
                if partial_meta.exists():
                    db_client.put_file_bytes(course, lecture, kind, PARTIAL_META, partial_meta.read_bytes())
                return {
                    "status": "rate_limited",
                    "rateLimit": {
                        "limit":             e.info.get("limit"),
                        "used":              e.info.get("used"),
                        "requested":         e.info.get("requested"),
                        "retryAfterSeconds": e.info.get("retry_after_seconds"),
                    },
                    "progress": {
                        "completed": e.info.get("completed_chunks"),
                        "total":     e.info.get("total_chunks"),
                    },
                }

            db_client.put_file_bytes(course, lecture, kind, "transcript.txt", transcript.encode("utf-8"))
            db_client.delete_file(course, lecture, kind, PARTIAL_TXT)
            db_client.delete_file(course, lecture, kind, PARTIAL_META)
            return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/summarize")
def run_summarize(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    try:
        if not db_client.file_exists(course, lecture, kind, "transcript.txt"):
            return {"status": "error", "message": "transcript.txt is required — run Transcribe first"}
        download = ["transcript.txt"]
        has_material = db_client.file_exists(course, lecture, kind, "material.pdf")
        if has_material:
            download.append("material.pdf")
        print(f"Summarize: material.pdf {'found — passing to Gemini' if has_material else 'not found — transcript only'}")
        with db_workspace(course, lecture, kind, download=download) as ws:
            summary = summarize(ws["transcript.txt"], ws.get("material.pdf") if has_material else None)
        db_client.put_summary(course, lecture, kind, summary)
        return {"status": "done", "usedMaterial": has_material}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/pdf")
def run_pdf(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    try:
        if not db_client.file_exists(course, lecture, kind, "summary.md"):
            return {"status": "error", "message": "summary.md is required — run Summarize first"}
        with db_workspace(course, lecture, kind, upload=["summary.pdf"]) as ws:
            # summary.md comes from get_summary (envelope-wrapped), not get_file_bytes,
            # so write it into the workspace dir manually next to the pandoc output.
            md_path = ws["summary.pdf"].parent / "summary.md"
            md_path.write_text(db_client.get_summary(course, lecture, kind), encoding="utf-8")
            convert_to_pdf(str(md_path))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}



@app.post("/courses/{course}/lectures/{lecture}/run/drive")
def run_drive(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    try:
        if not db_client.file_exists(course, lecture, kind, "summary.pdf"):
            return {"status": "error", "message": "summary.pdf is required — run PDF first"}
        subfolder = RECITATIONS_DIR if kind == "recitation" else None
        with db_workspace(course, lecture, kind, download=["summary.pdf"], upload=["drive_url.txt"]) as ws:
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


@app.post("/resume-all")
async def resume_all_endpoint():
    """Resume all: Already running or no pending lectures - skip. Otherwise call resume_all with scanned queue."""
    if resume_module._lock.locked():
        return {"status": "already_running", **resume_module.get_status()}
    queue = await resume_module.scan_pending()
    if not queue:
        return {"status": "empty_queue"}
    asyncio.create_task(resume_module.resume_all(queue))
    return {"status": "started", **resume_module.get_status()}


@app.get("/resume-status")
def resume_status_endpoint():
    """Live status snapshot for the resume runner. Cheap; polled by the UI."""
    return resume_module.get_status()


@app.get("/timing/{operation}")
def timing_stats(operation: str, file_size_bytes: int = Query(...)):
    return get_stats(operation, file_size_bytes)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
