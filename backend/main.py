import json
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

import db_client
from pipeline.strip_audio import strip_audio
from pipeline.transcribe import transcribe_audio, TranscribeRateLimitError, PARTIAL_TXT, PARTIAL_META
from pipeline.summarize import summarize
from pipeline.to_pdf import convert_to_pdf
from pipeline.upload_to_drive import upload_to_drive
from timing import init_db, get_stats

load_dotenv()
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
GDRIVE_ROOT_FOLDER = os.environ["GDRIVE_ROOT_FOLDER"]

RECITATIONS_DIR = "Recitations"

app = FastAPI()
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


@app.post("/courses/{course}/lectures/{lecture}/run/audio")
def run_audio(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    try:
        if not db_client.file_exists(course, lecture, kind, "video.mp4"):
            return {"status": "error", "message": "video.mp4 is required"}
        with tempfile.TemporaryDirectory() as tmp:
            video_path = os.path.join(tmp, "video.mp4")
            audio_path = os.path.join(tmp, "audio.mp3")
            Path(video_path).write_bytes(db_client.get_file_bytes(course, lecture, kind, "video.mp4"))
            strip_audio(video_path, audio_path)
            db_client.put_file_bytes(course, lecture, kind, "audio.mp3", Path(audio_path).read_bytes())
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
                transcript = transcribe_audio(str(audio_path), GROQ_API_KEY)
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
        with tempfile.TemporaryDirectory() as tmp:
            transcript_path = Path(tmp) / "transcript.txt"
            transcript_path.write_bytes(db_client.get_file_bytes(course, lecture, kind, "transcript.txt"))
            summary = summarize(transcript_path)
            db_client.put_summary(course, lecture, kind, summary)
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/pdf")
def run_pdf(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    try:
        if not db_client.file_exists(course, lecture, kind, "summary.md"):
            return {"status": "error", "message": "summary.md is required — run Summarize first"}
        with tempfile.TemporaryDirectory() as tmp:
            md_path = Path(tmp) / "summary.md"
            md_path.write_text(db_client.get_summary(course, lecture, kind), encoding="utf-8")
            convert_to_pdf(str(md_path))
            pdf_path = md_path.with_suffix(".pdf")
            db_client.put_file_bytes(course, lecture, kind, "summary.pdf", pdf_path.read_bytes())
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}



@app.post("/courses/{course}/lectures/{lecture}/run/drive")
def run_drive(course: str, lecture: str, kind: str = Query("lecture")):
    if err := _validate_kind(kind): return err
    try:
        if not db_client.file_exists(course, lecture, kind, "summary.pdf"):
            return {"status": "error", "message": "summary.pdf is required — run PDF first"}
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "summary.pdf"
            pdf_path.write_bytes(db_client.get_file_bytes(course, lecture, kind, "summary.pdf"))
            subfolder = RECITATIONS_DIR if kind == "recitation" else None
            url = upload_to_drive(
                str(pdf_path),
                course,
                GDRIVE_ROOT_FOLDER,
                f"{lecture}.pdf",
                subfolder=subfolder,
            )
        db_client.put_file_bytes(course, lecture, kind, "drive_url.txt", url.encode("utf-8"))
        return {"status": "done", "url": url}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/timing/{operation}")
def timing_stats(operation: str, file_size_bytes: int = Query(...)):
    return get_stats(operation, file_size_bytes)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
