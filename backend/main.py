import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pipeline.strip_audio import strip_audio
from pipeline.transcribe import transcribe_audio
from pipeline.summarize import summarize
from pipeline.to_pdf import convert_to_pdf

load_dotenv()
DATA_ROOT = os.environ["DATA_ROOT"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def lecture_dir(course: str, lecture: str) -> Path:
    return Path(DATA_ROOT) / course / lecture


@app.post("/courses/{course}/lectures/{lecture}/run/audio")
def run_audio(course: str, lecture: str):
    try:
        d = lecture_dir(course, lecture)
        strip_audio(str(d / "video.mp4"), str(d / "audio.mp3"))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/transcribe")
def run_transcribe(course: str, lecture: str):
    try:
        d = lecture_dir(course, lecture)
        transcript = transcribe_audio(str(d / "audio.mp3"), GROQ_API_KEY)
        (d / "transcript.txt").write_text(transcript, encoding="utf-8")
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/summarize")
def run_summarize(course: str, lecture: str):
    try:
        d = lecture_dir(course, lecture)
        transcript = (d / "transcript.txt").read_text(encoding="utf-8")
        summary = summarize(transcript)
        (d / "summary.md").write_text(summary, encoding="utf-8")
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/pdf")
def run_pdf(course: str, lecture: str):
    try:
        d = lecture_dir(course, lecture)
        convert_to_pdf(str(d / "summary.md"))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/courses/{course}/lectures/{lecture}/run/all")
def run_all(course: str, lecture: str):
    try:
        d = lecture_dir(course, lecture)
        strip_audio(str(d / "video.mp4"), str(d / "audio.mp3"))
        transcript = transcribe_audio(str(d / "audio.mp3"), GROQ_API_KEY)
        (d / "transcript.txt").write_text(transcript, encoding="utf-8")
        summary = summarize(transcript)
        (d / "summary.md").write_text(summary, encoding="utf-8")
        convert_to_pdf(str(d / "summary.md"))
        return {"status": "done"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
