import asyncio
import os
import signal
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from events.sse import broadcast_notify, close_all, subscribe
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fs import crud, materials, overview, tree
from fs import summaries as summaries_fs
from fs import summary as summary_fs
from fs.files import file_path
from fs.paths import lecture_dir

load_dotenv()
DATA_ROOT = os.environ["DATA_ROOT"]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Close SSE streams on SIGINT/SIGTERM so Ctrl-C exits cleanly instead of stalling on them."""

    # At signal time, not lifespan shutdown, which uvicorn runs only after connections close.
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}

    def handle(sig, frame):
        """Drain subscribers, then hand the signal back to whoever owned it (normally uvicorn's handle_exit)."""

        close_all()
        handler = previous[sig]
        if callable(handler):
            handler(sig, frame)
        else:
            signal.signal(sig, handler)
            signal.raise_signal(sig)

    for sig in previous:
        signal.signal(sig, handle)
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _error(message: str, status: int):
    """Build the service's failure body ({error})."""

    return JSONResponse({"error": message}, status_code=status)


@app.get("/tree")
def get_tree():
    """Return the full course tree."""

    return tree.read_tree()


@app.post("/courses")
async def post_course(request: Request):
    """Create a new course directory, optionally with a source_url."""

    try:
        body = await request.json()
        crud.create_course(body["name"], body.get("source_url"))
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.patch("/courses/{course}")
async def patch_course(course: str, request: Request):
    """Rename a course directory."""

    try:
        body = await request.json()
        crud.rename_course(course, body["name"])
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.patch("/courses/{course}/source_url")
async def patch_course_source_url(course: str, request: Request):
    """Set or clear a course's source URL (body: {source_url}); empty/null clears it."""

    try:
        body = await request.json()
        crud.set_course_source_url(course, body.get("source_url"))
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.patch("/courses/{course}/archived")
async def patch_course_archived(course: str, request: Request):
    """Archive or unarchive a course (toggles its .archived marker)."""

    try:
        body = await request.json()
        crud.set_course_archived(course, body["archived"])
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.post("/courses/{course}/lectures")
async def post_lecture(course: str, request: Request, kind: str = Query("lecture")):
    """Create a lecture or recitation under the given course."""

    try:
        body = await request.json()
        crud.create_lecture(course, body["name"], kind)
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.patch("/courses/{course}/lectures/{lecture}")
async def patch_lecture(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Rename a lecture or recitation."""

    try:
        body = await request.json()
        crud.rename_lecture(course, lecture, body["name"], kind)
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


def _post_run_audio(course: str, lecture: str, kind: str) -> None:
    """Blocking POST to backend's /run/audio; runs in a worker thread via asyncio.to_thread."""

    url = (
        f"{BACKEND_URL}/courses/{urllib.parse.quote(course, safe='')}"
        f"/lectures/{urllib.parse.quote(lecture, safe='')}"
        f"/run/audio?kind={urllib.parse.quote(kind, safe='')}"
    )
    try:
        # No timeout: stripping audio can take minutes, and a timeout would orphan the run.
        with urllib.request.urlopen(
            urllib.request.Request(url, method="POST"), timeout=None
        ) as resp:
            resp.read()
    except Exception as e:
        print(f"auto run/audio failed for {course}/{lecture} ({kind}): {e}", flush=True)


async def _trigger_audio(course: str, lecture: str, kind: str) -> None:
    """Fire-and-forget bridge that hands the blocking POST off to a worker thread."""

    await asyncio.to_thread(_post_run_audio, course, lecture, kind)


@app.put("/courses/{course}/lectures/{lecture}/video")
async def put_video(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Upload video.mp4 from a raw body, wiping derived artifacts, then fire-and-forget the
    backend's audio step; responds as soon as the bytes are on disk."""

    try:
        data = await request.body()
        crud.write_video(course, lecture, kind, data)
        asyncio.create_task(_trigger_audio(course, lecture, kind))
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.get("/courses/{course}/lectures/{lecture}/materials")
def get_materials(course: str, lecture: str, kind: str = Query("lecture")):
    """List a lecture's material pdfs, index-ordered; [] for an empty or missing lecture, as the tree degrades."""

    try:
        return {
            "materials": materials.list_materials(lecture_dir(course, lecture, kind))
        }
    except Exception as e:
        return _error(str(e), 400)


@app.post("/courses/{course}/lectures/{lecture}/materials")
async def post_material(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Save a raw-body PDF as the lecture's next material and return its allocated {name}."""

    try:
        data = await request.body()
        name = materials.write_material(course, lecture, kind, data)
        return JSONResponse({"name": name})
    except Exception as e:
        return _error(str(e), 400)


@app.delete("/courses/{course}/lectures/{lecture}/files/{name}")
def delete_file_endpoint(
    course: str, lecture: str, name: str, kind: str = Query("lecture")
):
    """Delete one file inside a lecture or recitation directory."""

    try:
        crud.delete_file(course, lecture, name, kind)
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.put("/courses/{course}/lectures/{lecture}/files/{name}")
async def put_file(
    course: str, lecture: str, name: str, request: Request, kind: str = Query("lecture")
):
    """Write raw body bytes to one file in a lecture dir; neutral — does NOT wipe derived artifacts."""

    try:
        data = await request.body()
        crud.write_file(course, lecture, name, kind, data)
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 400)


@app.head("/courses/{course}/lectures/{lecture}/files/{name}")
def head_file(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Return 200 if the file exists, 404 otherwise — cheap precondition check for the backend."""

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
        return _error(str(e), 500)


@app.put("/courses/{course}/lectures/{lecture}/summary")
async def put_summary(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Overwrite summary.md from a raw utf-8 body; first edit snapshots the original for later revert."""

    try:
        content = (await request.body()).decode("utf-8")
        summary_fs.write_summary(course, lecture, kind, content)
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 500)


@app.delete("/courses/{course}/lectures/{lecture}/summary")
def delete_summary(course: str, lecture: str, kind: str = Query("lecture")):
    """Revert summary.md to the preserved original_summary.md."""

    try:
        summary_fs.revert_summary(course, lecture, kind)
        return Response(status_code=204)
    except Exception as e:
        return _error(str(e), 500)


@app.get("/courses/{course}/lectures/{lecture}/files/{name}")
def get_file(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Stream a single lecture file (PDFs get the right media type for inline viewing)."""

    p = file_path(course, lecture, name, kind)
    if not p.exists():
        return Response("Not found", status_code=404)
    media_type = "application/pdf" if name.endswith(".pdf") else None
    return FileResponse(str(p), media_type=media_type)


@app.get("/courses/{course}/summaries")
def get_course_summaries(course: str):
    """Return every non-empty summary.md in a course so the client can full-text search the whole corpus."""

    try:
        return {"summaries": summaries_fs.read_course_summaries(course)}
    except FileNotFoundError as e:
        return _error(str(e), 404)
    except Exception as e:
        return _error(str(e), 400)


@app.put("/courses/{course}/overview/files/{name}")
async def put_overview_file(course: str, name: str, request: Request):
    """Write raw body bytes to a course-level overview file; 404 if the course doesn't exist."""

    try:
        data = await request.body()
        overview.write_overview_file(course, name, data)
        return Response(status_code=204)
    except FileNotFoundError as e:
        return _error(str(e), 404)
    except Exception as e:
        return _error(str(e), 400)


@app.get("/courses/{course}/overview/files")
def list_overview_files(course: str):
    """List {name, size, mtime} entries in a course's overview dir (empty list if absent)."""

    try:
        return {"files": overview.list_overview_files(course)}
    except Exception as e:
        return _error(str(e), 400)


@app.get("/courses/{course}/overview/meta")
def get_overview_meta(course: str):
    """Return the per-extractor course overview meta map."""

    try:
        return {"meta": overview.read_overview_meta(course)}
    except Exception as e:
        return _error(str(e), 400)


@app.patch("/courses/{course}/overview/meta")
async def patch_overview_meta(course: str, request: Request):
    """Merge one extractor's entry into a course's overview meta.json (body: {slug, entry})."""

    try:
        body = await request.json()
        overview.merge_overview_meta(course, body["slug"], body["entry"])
        return Response(status_code=204)
    except FileNotFoundError as e:
        return _error(str(e), 404)
    except Exception as e:
        return _error(str(e), 400)


@app.get("/courses/{course}/overview/files/{name}")
def get_overview_file(course: str, name: str):
    """Stream a single course-level overview file (PDFs get the right media type for inline viewing)."""

    try:
        p = overview.overview_file_path(course, name)
    except Exception as e:
        return _error(str(e), 400)
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
