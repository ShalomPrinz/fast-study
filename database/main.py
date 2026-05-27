import asyncio
import os
import urllib.parse
import urllib.request

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from fs import crud, summary as summary_fs, tree
from fs.files import file_path
from events.sse import subscribe, broadcast_notify

load_dotenv()
DATA_ROOT = os.environ["DATA_ROOT"]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ok(error: str | None = None, status: int = 200):
    """Build the service's uniform JSON response envelope ({ok: true} or {ok: false, error})."""

    if error is not None:
        return JSONResponse({"ok": False, "error": error}, status_code=status)
    return JSONResponse({"ok": True})


@app.get("/tree")
def get_tree():
    """Return the full course tree."""

    return tree.read_tree()


@app.post("/courses")
async def post_course(request: Request):
    """Create a new course directory."""

    try:
        body = await request.json()
        crud.create_course(body["name"])
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.patch("/courses/{course}")
async def patch_course(course: str, request: Request):
    """Rename a course directory."""

    try:
        body = await request.json()
        crud.rename_course(course, body["name"])
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.post("/courses/{course}/lectures")
async def post_lecture(course: str, request: Request, kind: str = Query("lecture")):
    """Create a lecture or recitation under the given course."""

    try:
        body = await request.json()
        crud.create_lecture(course, body["name"], kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.patch("/courses/{course}/lectures/{lecture}")
async def patch_lecture(course: str, lecture: str, request: Request, kind: str = Query("lecture")):
    """Rename a lecture or recitation."""

    try:
        body = await request.json()
        crud.rename_lecture(course, lecture, body["name"], kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


def _post_run_audio(course: str, lecture: str, kind: str) -> None:
    """Blocking POST to backend's /run/audio; runs in a worker thread via asyncio.to_thread."""

    url = (
        f"{BACKEND_URL}/courses/{urllib.parse.quote(course, safe='')}"
        f"/lectures/{urllib.parse.quote(lecture, safe='')}"
        f"/run/audio?kind={urllib.parse.quote(kind, safe='')}"
    )
    try:
        # strip_audio can take a while; no upper bound on the wait.
        with urllib.request.urlopen(urllib.request.Request(url, method="POST"), timeout=None) as resp:
            resp.read()
    except Exception as e:
        print(f"auto run/audio failed for {course}/{lecture} ({kind}): {e}", flush=True)


async def _trigger_audio(course: str, lecture: str, kind: str) -> None:
    """Fire-and-forget bridge that hands the blocking POST off to a worker thread."""

    await asyncio.to_thread(_post_run_audio, course, lecture, kind)


@app.put("/courses/{course}/lectures/{lecture}/video")
async def put_video(course: str, lecture: str, request: Request, kind: str = Query("lecture")):
    """Upload video.mp4 from a raw request body, wiping any derived artifacts.

    On success, fire-and-forget triggers backend's /run/audio so a downloader
    upload automatically kicks off the audio-extraction step — the response
    returns as soon as the file is on disk, not when audio is done."""

    try:
        data = await request.body()
        crud.write_video(course, lecture, kind, data)
        asyncio.create_task(_trigger_audio(course, lecture, kind))
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.delete("/courses/{course}/lectures/{lecture}/files/{name}")
def delete_file_endpoint(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Delete one file inside a lecture or recitation directory."""

    try:
        crud.delete_file(course, lecture, name, kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.put("/courses/{course}/lectures/{lecture}/files/{name}")
async def put_file(course: str, lecture: str, name: str, request: Request, kind: str = Query("lecture")):
    """Write raw body bytes to a single file in a lecture dir. Neutral write — does NOT wipe derived artifacts (unlike PUT /video)."""

    try:
        data = await request.body()
        crud.write_file(course, lecture, name, kind, data)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.head("/courses/{course}/lectures/{lecture}/files/{name}")
def head_file(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Return 200 if the file exists, 404 otherwise. Cheap existence check for backend pipeline preconditions."""

    p = file_path(course, lecture, name, kind)
    if not p.exists():
        return Response(status_code=404)
    return Response(status_code=200)


@app.get("/courses/{course}/lectures/{lecture}/summary")
def get_summary(course: str, lecture: str, kind: str = Query("lecture")):
    """Return summary.md content plus a flag for whether an unedited original is preserved."""

    try:
        return summary_fs.read_summary(course, lecture, kind)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.put("/courses/{course}/lectures/{lecture}/summary")
async def put_summary(course: str, lecture: str, request: Request, kind: str = Query("lecture")):
    """Overwrite summary.md from a raw utf-8 body; first edit snapshots the original for later revert."""

    try:
        content = (await request.body()).decode("utf-8")
        summary_fs.write_summary(course, lecture, kind, content)
        return _ok()
    except Exception as e:
        return _ok(str(e), 500)


@app.delete("/courses/{course}/lectures/{lecture}/summary")
def delete_summary(course: str, lecture: str, kind: str = Query("lecture")):
    """Revert summary.md to the preserved original_summary.md."""

    try:
        summary_fs.revert_summary(course, lecture, kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 500)


@app.get("/courses/{course}/lectures/{lecture}/files/{name}")
def get_file(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Stream a single lecture file (PDFs get the right media type for inline viewing)."""

    p = file_path(course, lecture, name, kind)
    if not p.exists():
        return Response("Not found", status_code=404)
    media_type = "application/pdf" if name.endswith(".pdf") else None
    return FileResponse(str(p), media_type=media_type)


@app.get("/events")
async def events():
    """Open a long-lived SSE stream for cross-service notify events."""

    return StreamingResponse(subscribe(), media_type="text/event-stream")


@app.post("/notify")
async def notify(request: Request):
    """Fan a notify event out to every SSE subscriber; body is drained but ignored."""

    await request.body()
    broadcast_notify()
    return Response(status_code=204)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
