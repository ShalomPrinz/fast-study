import asyncio
import json
import logging
import mimetypes
import os
import signal
import threading
from contextlib import asynccontextmanager
from json import JSONDecodeError

import runtime
import sentry_policy
import sentry_sdk
import settings
from events.sse import broadcast_notify, close_all, subscribe
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fs import (
    assignments,
    crud,
    figures,
    materials,
    merged,
    overview,
    paths,
    tree,
    video_import,
)
from fs import sources as skips
from fs import summaries as summaries_fs
from fs import summary as summary_fs
from fs.files import file_path
from fs.paths import (
    DONE_MARKER,
    LECTURES_ONLY_MARKER,
    SKIPPED_MARKER,
    SOURCE_URL_MARKER,
    AssignmentFileNotFound,
    CodedError,
    CodedValueError,
    CourseNotFound,
    DataRootNotConfigured,
    FileLocked,
    FolderInUse,
    LectureNotFound,
    NameReserved,
    NameTaken,
    lecture_dir,
)
from logging_setup import setup_logging
from sentry_sdk.transport import HttpTransport
from starlette.concurrency import run_in_threadpool

setup_logging()
log = logging.getLogger("db")

# At import, after `runtime` loaded .env, so the dev uvicorn path and the frozen entry both init
# before the app exists; no DSN means no SDK at all. The gated transport lets POST /config stop
# sending live, without closing or re-initing the client.
if sentry_policy.enabled():
    sentry_sdk.init(
        **sentry_policy.options("database"),
        transport=sentry_policy.gated(HttpTransport),
    )
    sentry_sdk.set_tags(sentry_policy.tags("database"))

# The dev __main__ path and the frozen dispatcher both read the port from here, so there is one default.
DEFAULT_PORT = 8001

# An absent or blank root leaves the service unconfigured rather than failing to boot: that is the
# state the first-run wall exists for, and POST /config is how it gets filled in.
if os.environ.get("DATA_ROOT"):
    paths.set_data_root(os.environ["DATA_ROOT"])

# Seeded like the root: `.env` in dev, the launcher's store env under Electron; POST /config changes it live.
tree.set_course_structure(
    settings.stored_course_structure(os.environ.get("COURSE_STRUCTURE"))
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
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

# Added first so CORS ends up outside it, and a 401 still carries the CORS headers the browser needs.
runtime.install_secret_check(app)

app.add_middleware(
    CORSMiddleware,
    # app://bundle is the packaged frontend's origin — browsers send it with no trailing slash, so match it verbatim.
    **runtime.cors_origins(["http://localhost:5173", "app://bundle"]),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Liveness only — what the launcher waits on before opening the window. Reports nothing
    else on purpose: DATA_ROOT and the key-set flags stay on routes that can be refused."""

    return {"status": "ok"}


def _error(message: str, status: int, code: str, params: dict | None = None):
    """Build the service's failure body ({error, code, params}) — English prose, machine code, values."""

    return JSONResponse(
        {"error": message, "code": code, "params": params or {}}, status_code=status
    )


def _failure(exc: Exception, status: int, code: str, params: dict | None = None):
    """Build the failure body for a caught exception: its own code when it carries one, else the
    route's wrapper code with str(exc) as params.detail. Routes catch Exception, so that is the norm."""

    if isinstance(exc, DataRootNotConfigured):
        return _error(str(exc), 409, exc.code, exc.params)
    if isinstance(exc, (FileLocked, FolderInUse)):
        return _error(str(exc), 423, exc.code, exc.params)
    if isinstance(exc, (NameTaken, NameReserved)):
        return _error(str(exc), 409, exc.code, exc.params)
    if isinstance(exc, (LectureNotFound, CourseNotFound, AssignmentFileNotFound)):
        return _error(str(exc), 404, exc.code, exc.params)
    if isinstance(exc, CodedError):
        return _error(str(exc), status, exc.code, exc.params)
    # A malformed or incomplete JSON body is the caller's bug whatever the route meant to do.
    if isinstance(exc, (KeyError, JSONDecodeError)):
        return _error(str(exc), status, "bad_request_body", {"detail": str(exc)})
    return _error(str(exc), status, code, {**(params or {}), "detail": str(exc)})


@app.exception_handler(DataRootNotConfigured)
def data_root_not_configured(_request: Request, exc: DataRootNotConfigured):
    """Answer 409 on the endpoints that have no blanket handler of their own, /tree above all."""

    return _error(str(exc), 409, exc.code, exc.params)


@app.get("/tree")
def get_tree():
    """Return the full course tree."""

    return tree.read_tree()


@app.post("/courses")
async def post_course(request: Request):
    """Create a new course directory, optionally with a source_url, answering the sanitized folder name actually created."""

    name = None
    try:
        body = await request.json()
        name = body["name"]
        effective = crud.create_course(name, body.get("source_url"))
        broadcast_notify("tree")
        return {"name": effective}
    except Exception as e:
        return _failure(e, 400, "create_dir_failed", {"path": name})


@app.patch("/courses/{course}")
async def patch_course(course: str, request: Request):
    """Rename a course directory, answering the sanitized folder name actually created."""

    name = None
    try:
        body = await request.json()
        name = body["name"]
        effective = crud.rename_course(course, name)
        broadcast_notify("tree")
        return {"name": effective}
    except Exception as e:
        return _failure(e, 400, "rename_failed", {"from": course, "to": name})


@app.patch("/courses/{course}/source_url")
async def patch_course_source_url(course: str, request: Request):
    """Set or clear a course's source URL (body: {source_url}); empty/null clears it."""

    try:
        body = await request.json()
        crud.set_course_source_url(course, body.get("source_url"))
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": SOURCE_URL_MARKER})


def _bool_field(body: dict, field: str) -> bool:
    """Return body[field], refusing anything but a JSON boolean."""

    # A truth test would let the string "false" switch the flag on.
    if not isinstance(body[field], bool):
        raise CodedValueError(
            f"{field} must be a boolean", "setting_must_be_boolean", field=field
        )
    return body[field]


@app.patch("/courses/{course}/lectures_only")
async def patch_course_lectures_only(course: str, request: Request):
    """Pick or unpick a course as lectures-only (toggles its .lectures_only marker)."""

    try:
        body = await request.json()
        crud.set_course_lectures_only(course, _bool_field(body, "lectures_only"))
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": LECTURES_ONLY_MARKER})


@app.post("/courses/{course}/skipped")
async def post_course_skipped(course: str, request: Request):
    """Add and/or remove discovery refs in the course's skip set (body: {add?, remove?}); answers the resulting {refs}."""

    # On the loop, no await between read and write: concurrent batches from server and frontend serialise.
    try:
        body = await request.json()
        refs, changed = skips.update_skipped(course, body)
        if changed:
            broadcast_notify("tree")
        return {"refs": refs}
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": SKIPPED_MARKER})


@app.post("/courses/{course}/lectures")
async def post_lecture(course: str, request: Request, kind: str = Query("lecture")):
    """Create a lecture or recitation, answering the sanitized folder name actually created."""

    name = None
    try:
        body = await request.json()
        name = body["name"]
        effective = crud.create_lecture(course, name, kind)
        broadcast_notify("tree")
        return {"name": effective}
    except Exception as e:
        return _failure(e, 400, "create_dir_failed", {"path": name})


@app.patch("/courses/{course}/lectures/{lecture}")
async def patch_lecture(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Rename a lecture or recitation, answering the sanitized folder name actually created."""

    name = None
    try:
        body = await request.json()
        name = body["name"]
        effective = crud.rename_lecture(course, lecture, name, kind)
        broadcast_notify("tree")
        return {"name": effective}
    except Exception as e:
        return _failure(e, 400, "rename_failed", {"from": lecture, "to": name})


@app.put("/courses/{course}/lectures/{lecture}/done")
async def put_lecture_done(course: str, lecture: str, kind: str = Query("lecture")):
    """Mark a lecture or recitation studied (creates its .done marker; idempotent)."""

    try:
        crud.set_lecture_done(course, lecture, kind, True)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": DONE_MARKER})


@app.delete("/courses/{course}/lectures/{lecture}/done")
async def delete_lecture_done(course: str, lecture: str, kind: str = Query("lecture")):
    """Clear a lecture or recitation's studied mark (removes its .done marker; idempotent)."""

    try:
        crud.set_lecture_done(course, lecture, kind, False)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_delete_failed", {"file": DONE_MARKER})


@app.put("/courses/{course}/lectures/{lecture}/video")
async def put_video(
    course: str,
    lecture: str,
    request: Request,
    kind: str = Query("lecture"),
    source: str | None = Query(None),
):
    """Upload video.mp4 from a raw body streamed to a temp file, wiping derived artifacts (materials stay); ?source= records its discovery ref."""

    tmp = None
    try:
        try:
            # Refused before the first body byte, so a doomed upload fails fast; the wipe re-probes after the body.
            d = crud.check_video_target(course, lecture, kind)
            crud.check_video_wipe_unlocked(d)
        except Exception as refusal:
            # Unread body at close makes h11 reset the connection and the coded reply is lost, so discard it first.
            async for _ in request.stream():
                pass
            return _failure(refusal, 400, "file_write_failed", {"file": "video.mp4"})
        # Staged in DATA_ROOT, not the course, so a course rename mid-stream cannot strand it, and no lecture dir exists to clean up.
        tmp = paths.new_video_tmp(paths.data_root())
        with open(tmp, "wb") as out:
            async for chunk in request.stream():
                # Off the loop per chunk, so a multi-GB body never stalls other requests.
                await run_in_threadpool(out.write, chunk)
        d = await run_in_threadpool(crud.prepare_video_dir, course, lecture, kind)
        await run_in_threadpool(crud.place_video, d, tmp)
        if source:
            skips.write_video_source(d, source)
        return Response(status_code=204)
    except Exception as e:
        # A mid-body disconnect lands here too; the peer is gone, so the coded body is for the log and tests only.
        return _failure(e, 400, "file_write_failed", {"file": "video.mp4"})
    finally:
        # Cleanup never replaces the real outcome; after a placement it retries the unlink place_video could not do.
        if tmp is not None:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                log.warning("video upload: temp cleanup failed")


def _ndjson(obj: dict) -> str:
    """Encode one NDJSON line of the import stream."""

    return json.dumps(obj, ensure_ascii=False) + "\n"


def _import_error_line(exc: Exception) -> str:
    """Build the stream's final error line; the user's source path never reaches params, message or log."""

    if isinstance(exc, CodedError):
        code, params, message = exc.code, exc.params, str(exc)
    else:
        # OSError's str() embeds the source path; strerror is the OS text alone.
        detail = getattr(exc, "strerror", None) or type(exc).__name__
        code, params = "video_import_failed", {"file": "video.mp4", "detail": detail}
        message = f"importing the video failed: {detail}"
    log.warning("video import failed: %s", code)
    return _ndjson({"error": {"code": code, "params": params, "message": message}})


# Strong refs: the loop holds tasks weakly, and an unread response must not lose its worker.
_import_tasks: set = set()


def _import_stream(d, src, mode):
    """Start the import worker now, return the NDJSON stream of its progress; the worker is not tied to the stream starting, so a response nobody reads still releases the claimed dir."""

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    cancelled = threading.Event()

    def progress(copied: int, total: int):
        loop.call_soon_threadsafe(queue.put_nowait, {"copied": copied, "total": total})

    touched = threading.Event()
    task = asyncio.ensure_future(
        asyncio.to_thread(
            video_import.run_import,
            d,
            src,
            mode,
            progress,
            cancelled,
            touched,
        )
    )

    def finished(_t):
        # Owned by the worker's task, not the stream: a cancel from any direction still tags a lecture the wipe changed, success or failure.
        if touched.is_set():
            broadcast_notify("tree")
        if not _t.cancelled():
            _t.exception()  # marks it retrieved; the stream reports it
        queue.put_nowait(None)

    task.add_done_callback(finished)
    _import_tasks.add(task)
    task.add_done_callback(_import_tasks.discard)
    return _drain_import(task, queue, cancelled)


async def _drain_import(task, queue, cancelled):
    """Yield the worker's queued lines as NDJSON, then its verdict; cancel the worker if the client leaves."""

    try:
        while (item := await queue.get()) is not None:
            yield _ndjson(item)
        yield _ndjson({"done": True, "originalKept": task.result()})
    except Exception as e:
        yield _import_error_line(e)
    finally:
        # A disconnect closes the generator here: the worker stops at its next chunk and deletes its temp file.
        if not task.done():
            cancelled.set()


@app.post("/courses/{course}/lectures/{lecture}/video/import")
async def import_video(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Copy or move a local .mp4 (body {path, mode}) in as video.mp4, streaming NDJSON progress; same wipe as PUT …/video."""

    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise CodedValueError(
                "body must be a JSON object",
                "bad_request_body",
                detail="body must be a JSON object",
            )
        d, src = video_import.prepare_import(
            course, lecture, kind, body["path"], body["mode"]
        )
    except Exception as e:
        return _failure(e, 400, "video_import_failed", {"file": "video.mp4"})
    return StreamingResponse(
        _import_stream(d, src, body["mode"]), media_type="application/x-ndjson"
    )


@app.get("/courses/{course}/lectures/{lecture}/materials")
def get_materials(course: str, lecture: str, kind: str = Query("lecture")):
    """List a lecture's materials, index-ordered; [] for an empty or missing lecture, as the tree degrades."""

    try:
        return {
            "materials": materials.list_materials(lecture_dir(course, lecture, kind))
        }
    except Exception as e:
        return _failure(e, 400, "file_read_failed")


@app.post("/courses/{course}/lectures/{lecture}/materials")
async def post_material(
    course: str,
    lecture: str,
    request: Request,
    kind: str = Query("lecture"),
    source: str | None = Query(None),
    filename: str | None = Query(None),
):
    """Save a raw-body file as the lecture's next material, tagged with its opaque source and display filename, and return its {name}."""

    try:
        data = await request.body()
        name = materials.write_material(course, lecture, kind, data, source, filename)
        return JSONResponse({"name": name})
    except Exception as e:
        # The name is allocated inside the failing write, so only the OS detail is knowable here.
        return _failure(e, 400, "file_write_failed")


@app.patch("/courses/{course}/lectures/{lecture}/materials/{name}")
async def patch_material(
    course: str, lecture: str, name: str, request: Request, kind: str = Query("lecture")
):
    """Set a material's attach flag (body: {attach: bool}); 404 when the name isn't an existing material."""

    # On the loop, like delete: it rewrites .materials.json, which only the single async writer may do.
    try:
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("attach"), bool):
            raise CodedValueError(
                "attach must be a boolean",
                "bad_request_body",
                detail="attach must be a boolean",
            )
        if not materials.set_attach(course, lecture, kind, name, body["attach"]):
            return _error("Not found", 404, "file_not_found", {"file": name})
        broadcast_notify("tree")
        return Response(status_code=204)
    except OSError as e:
        # The flag lives only in the sidecar, so a failed write is a server fault, not a bad request.
        return _failure(e, 500, "file_write_failed", {"file": name})
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": name})


@app.put("/courses/{course}/lectures/{lecture}/summary-materials")
async def put_summary_materials(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Record which materials the current summary.md was built from (body: {materials: [str]})."""

    try:
        body = await request.json()
        names = body.get("materials") if isinstance(body, dict) else None
        summary_fs.write_summary_materials(course, lecture, kind, names)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(
            e, 400, "file_write_failed", {"file": paths.SUMMARY_MATERIALS_MARKER}
        )


@app.delete("/courses/{course}/lectures/{lecture}/files/{name}")
async def delete_file_endpoint(
    course: str, lecture: str, name: str, kind: str = Query("lecture")
):
    """Delete one file inside a lecture or recitation directory."""

    # On the loop, not the threadpool: a material delete rewrites .materials.json, and only the
    # single async writer keeps that from interleaving with POST /…/materials (docs/LAYOUT.md).
    try:
        crud.delete_file(course, lecture, name, kind)
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_delete_failed", {"file": name})


@app.post("/courses/{course}/lectures/{lecture}/removed")
async def post_removed(
    course: str, lecture: str, request: Request, kind: str = Query("lecture")
):
    """Delete the named intermediates (body: {files}); the tree then derives them as removed."""

    files = None
    try:
        body = await request.json()
        # A non-object body passes None on, which remove_files refuses as bad_request_body.
        files = body.get("files") if isinstance(body, dict) else None
        crud.remove_files(course, lecture, kind, files)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        # Body, name, lock and unlink failures are coded already, so the files param is only a fallback.
        named = ", ".join(map(str, files)) if isinstance(files, list) else ""
        return _failure(e, 400, "file_delete_failed", {"file": named})


@app.put("/courses/{course}/lectures/{lecture}/files/{name}")
async def put_file(
    course: str, lecture: str, name: str, request: Request, kind: str = Query("lecture")
):
    """Write raw body bytes to one file in an existing lecture dir; neutral — does NOT wipe derived artifacts."""

    try:
        data = await request.body()
        crud.write_file(course, lecture, name, kind, data)
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": name})


@app.head("/courses/{course}/lectures/{lecture}/files/{name}")
def head_file(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Return 200 if the file exists, 404 otherwise — cheap precondition check for the backend."""

    try:
        p = file_path(course, lecture, name, kind)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": name})
    # A bodyless 404 on purpose: absence is this route's normal answer, not a failure.
    if not p.exists():
        return Response(status_code=404)
    return Response(status_code=200)


@app.put("/courses/{course}/lectures/{lecture}/figures/{name}")
async def put_figure(
    course: str, lecture: str, name: str, request: Request, kind: str = Query("lecture")
):
    """Write one summary figure (fig<N>.<ext>) from a raw body; neutral, and 404 if the lecture is missing."""

    try:
        figures.write_figure(course, lecture, name, kind, await request.body())
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": name})


@app.get("/courses/{course}/lectures/{lecture}/figures/{name}")
def get_figure(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Stream one summary figure with its media type."""

    try:
        p = figures.figure_path(course, lecture, name, kind)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": name})
    if not p.is_file():
        return _error("Not found", 404, "file_not_found", {"file": name})
    return FileResponse(str(p), media_type=mimetypes.guess_type(name)[0])


@app.get("/courses/{course}/lectures/{lecture}/figures")
def list_figures(course: str, lecture: str, kind: str = Query("lecture")):
    """List the summary figure names in natural order; [] for a missing lecture or folder."""

    try:
        return {"figures": figures.list_figures(course, lecture, kind)}
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": "figures"})


@app.delete("/courses/{course}/lectures/{lecture}/figures")
def delete_figures(course: str, lecture: str, kind: str = Query("lecture")):
    """Clear every summary figure of a lecture (idempotent); 404 if the lecture is missing."""

    try:
        figures.clear_figures(course, lecture, kind)
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_delete_failed", {"file": "figures"})


@app.get("/courses/{course}/lectures/{lecture}/summary")
def get_summary(course: str, lecture: str, kind: str = Query("lecture")):
    """Return summary.md content plus a flag for whether an unedited original is preserved."""

    try:
        return summary_fs.read_summary(course, lecture, kind)
    except Exception as e:
        return _failure(e, 500, "summary_io_failed")


@app.put("/courses/{course}/lectures/{lecture}/summary")
async def put_summary(
    course: str,
    lecture: str,
    request: Request,
    kind: str = Query("lecture"),
    fresh: bool = Query(False),
):
    """Overwrite summary.md from a raw utf-8 body; first edit snapshots the original for later revert,
    while fresh=true (new pipeline output) drops any snapshot instead."""

    try:
        content = (await request.body()).decode("utf-8")
        summary_fs.write_summary(course, lecture, kind, content, fresh)
        # An editor open on this summary in another window reloads or warns off this.
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 500, "summary_io_failed")


@app.delete("/courses/{course}/lectures/{lecture}/summary")
async def delete_summary(course: str, lecture: str, kind: str = Query("lecture")):
    """Revert summary.md to the preserved original_summary.md."""

    try:
        summary_fs.revert_summary(course, lecture, kind)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 500, "summary_io_failed")


@app.get("/courses/{course}/lectures/{lecture}/files/{name}")
def get_file(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Stream a single lecture file (PDFs get the right media type for inline viewing)."""

    try:
        p = file_path(course, lecture, name, kind)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": name})
    if not p.exists():
        return _error("Not found", 404, "file_not_found", {"file": name})
    media_type = mimetypes.guess_type(name)[0]
    return FileResponse(str(p), media_type=media_type)


@app.get("/courses/{course}/lectures/{lecture}/files/{name}/path")
def get_file_path(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    """Return a lecture file's absolute on-disk path, so the launcher can open it in the user's own app."""

    try:
        p = file_path(course, lecture, name, kind)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": name})
    if not p.exists():
        return _error("Not found", 404, "file_not_found", {"file": name})
    return {"path": str(p)}


@app.post("/courses/{course}/assignments/{name}/files")
async def post_assignment_file(
    course: str,
    name: str,
    request: Request,
    filename: str = Query(...),
    source: str | None = Query(None),
):
    """Save a raw-body file in an assignment under a collision-free name; answer the effective {assignment, name}."""

    try:
        data = await request.body()
        # Allocation, write and manifest record run under fs/assignments._manifest_lock.
        assignment, effective = assignments.write_assignment_file(
            course, name, filename, data, source
        )
        broadcast_notify("tree")
        return {"assignment": assignment, "name": effective}
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": filename})


@app.put("/courses/{course}/assignments/{name}/done")
async def put_assignment_done(course: str, name: str):
    """Mark an assignment studied (creates its .done marker; idempotent)."""

    try:
        assignments.set_assignment_done(course, name, True)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": DONE_MARKER})


@app.delete("/courses/{course}/assignments/{name}/done")
async def delete_assignment_done(course: str, name: str):
    """Clear an assignment's studied mark (removes its .done marker; idempotent)."""

    try:
        assignments.set_assignment_done(course, name, False)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_delete_failed", {"file": DONE_MARKER})


@app.get("/courses/{course}/assignments/{name}/files/{file}/path")
def get_assignment_file_path(course: str, name: str, file: str):
    """Return an assignment file's absolute on-disk path, for the launcher's open, open-with and reveal."""

    try:
        p = assignments.assignment_file_path(course, name, file)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": file})
    if not p.is_file():
        return _error("Not found", 404, "file_not_found", {"file": file})
    return {"path": str(p)}


@app.get("/courses/{course}/assignments/{name}/files/{file}")
def get_assignment_file(course: str, name: str, file: str):
    """Stream an assignment file's bytes, for browser dev's open."""

    try:
        p = assignments.assignment_file_path(course, name, file)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": file})
    if not p.is_file():
        return _error("Not found", 404, "file_not_found", {"file": file})
    return FileResponse(str(p), media_type=mimetypes.guess_type(file)[0])


@app.patch("/courses/{course}/assignments/{name}/files/{file}")
async def patch_assignment_file(course: str, name: str, file: str, request: Request):
    """Set whether an assignment file is sent to Gemini (body: {attach: bool})."""

    try:
        body = await request.json()
        value = body.get("attach") if isinstance(body, dict) else None
        assignments.set_file_attach(course, name, file, value)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": file})


@app.put("/courses/{course}/assignments/{name}/lectures")
async def put_assignment_lectures(course: str, name: str, request: Request):
    """Replace an assignment's course-material selection (body: {lectures: [{name, kind}]})."""

    try:
        body = await request.json()
        value = body.get("lectures") if isinstance(body, dict) else None
        assignments.set_lectures(course, name, value)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": ".assignment_meta.json"})


@app.get("/courses/{course}/assignments/{name}/docs/{doc}")
def get_assignment_doc(course: str, name: str, doc: str):
    """Return a generated doc's content plus whether an unedited original is preserved."""

    try:
        return assignments.read_doc(course, name, doc)
    except Exception as e:
        return _failure(e, 500, "summary_io_failed")


@app.put("/courses/{course}/assignments/{name}/docs/{doc}")
async def put_assignment_doc(
    course: str,
    name: str,
    doc: str,
    request: Request,
    fresh: bool = Query(False),
):
    """Overwrite a generated doc from a raw utf-8 body, with the same snapshot rules as PUT …/summary."""

    try:
        content = (await request.body()).decode("utf-8")
        assignments.write_doc(course, name, doc, content, fresh)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 500, "summary_io_failed")


@app.delete("/courses/{course}/assignments/{name}/docs/{doc}")
async def delete_assignment_doc(course: str, name: str, doc: str):
    """Restore a generated doc from its preserved original."""

    try:
        assignments.revert_doc(course, name, doc)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 500, "summary_io_failed")


@app.get("/courses/{course}/assignments/{name}/generated/{file}/path")
def get_assignment_generated_path(course: str, name: str, file: str):
    """Return a generated file's absolute on-disk path, for the launcher's open, open-with and reveal."""

    try:
        p = assignments.generated_path(course, name, file)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": file})
    if not p.is_file():
        return _error("Not found", 404, "file_not_found", {"file": file})
    return {"path": str(p)}


@app.get("/courses/{course}/assignments/{name}/generated/{file}")
def get_assignment_generated(course: str, name: str, file: str):
    """Stream one whitelisted .generated/ file's bytes."""

    try:
        p = assignments.generated_path(course, name, file)
    except Exception as e:
        return _failure(e, 400, "file_read_failed", {"file": file})
    if not p.is_file():
        return _error("Not found", 404, "file_not_found", {"file": file})
    return FileResponse(str(p), media_type=mimetypes.guess_type(file)[0])


@app.put("/courses/{course}/assignments/{name}/generated/{file}")
async def put_assignment_generated(course: str, name: str, file: str, request: Request):
    """Write one whitelisted .generated/ file; neutral, never creates the assignment."""

    try:
        data = await request.body()
        assignments.write_generated(course, name, file, data)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": file})


@app.delete("/courses/{course}/assignments/{name}/generated/{file}")
async def delete_assignment_generated(course: str, name: str, file: str):
    """Delete one whitelisted .generated/ file; a pdf takes its warning with it."""

    try:
        assignments.delete_generated(course, name, file)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_delete_failed", {"file": file})


@app.get("/courses/{course}/summaries")
def get_course_summaries(course: str):
    """Return every non-empty summary.md in a course so the client can full-text search the whole corpus."""

    try:
        return {"summaries": summaries_fs.read_course_summaries(course)}
    except FileNotFoundError as e:
        return _failure(e, 404, "course_not_found", {"course": course})
    except Exception as e:
        return _failure(e, 400, "summary_io_failed")


@app.put("/courses/{course}/overview/files/{name}")
async def put_overview_file(course: str, name: str, request: Request):
    """Write raw body bytes to a course-level overview file; 404 if the course doesn't exist."""

    try:
        data = await request.body()
        overview.write_overview_file(course, name, data)
        return Response(status_code=204)
    except FileNotFoundError as e:
        return _failure(e, 404, "course_not_found", {"course": course})
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": name})


@app.get("/courses/{course}/overview/files")
def list_overview_files(course: str):
    """List {name, size, mtime} entries in a course's overview dir (empty list if absent)."""

    try:
        return {"files": overview.list_overview_files(course)}
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")


@app.get("/courses/{course}/overview/meta")
def get_overview_meta(course: str):
    """Return the per-extractor course overview meta map."""

    try:
        return {"meta": overview.read_overview_meta(course)}
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")


@app.patch("/courses/{course}/overview/meta")
async def patch_overview_meta(course: str, request: Request):
    """Merge one extractor's entry into a course's overview meta.json (body: {slug, entry})."""

    try:
        body = await request.json()
        overview.merge_overview_meta(course, body["slug"], body["entry"])
        return Response(status_code=204)
    except FileNotFoundError as e:
        return _failure(e, 404, "course_not_found", {"course": course})
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": overview.OVERVIEW_META})


@app.get("/courses/{course}/overview/files/{name}")
def get_overview_file(course: str, name: str):
    """Stream a single course-level overview file (PDFs get the right media type for inline viewing)."""

    try:
        p = overview.overview_file_path(course, name)
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")
    if not p.exists():
        return _error("Not found", 404, "file_not_found", {"file": name})
    media_type = mimetypes.guess_type(name)[0]
    return FileResponse(str(p), media_type=media_type)


@app.get("/courses/{course}/overview/files/{name}/path")
def get_overview_file_path(course: str, name: str):
    """Return an overview file's absolute on-disk path, so the launcher can open it in the user's own app."""

    try:
        p = overview.overview_file_path(course, name)
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")
    if not p.exists():
        return _error("Not found", 404, "file_not_found", {"file": name})
    return {"path": str(p)}


@app.get("/courses/{course}/headings")
def get_course_headings(course: str):
    """Return each lecture's and recitation's first summary heading, keyed `<kind>:<name>`; read-only."""

    try:
        return {"headings": summary_fs.course_headings(course)}
    except Exception as e:
        return _failure(e, 400, "file_read_failed")


@app.get("/courses/{course}/merged")
def list_merged(course: str):
    """List a course's merged PDFs newest first, each with per-part exists/current_pdf_mtime and a stale flag."""

    try:
        return {"merged": merged.list_merged(course)}
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")


@app.patch("/courses/{course}/merged/meta")
async def patch_merged_meta(course: str, request: Request):
    """Set one merged PDF's meta entry under its sanitized title (body: {title, entry}); replaces it wholly."""

    # On the loop with no await between read and write: the single async writer keeps the RMW atomic.
    try:
        body = await request.json()
        title = body["title"]
        if not isinstance(title, str):
            raise CodedValueError(
                "title must be a string",
                "bad_request_body",
                detail="title must be a string",
            )
        merged.merge_merged_meta(course, title, body["entry"])
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "file_write_failed", {"file": overview.OVERVIEW_META})


@app.get("/courses/{course}/merged/{title}")
def get_merged(course: str, title: str):
    """Resolve a title to its sanitized name and enriched entry (entry is null with no meta or no pdf)."""

    try:
        name, entry = merged.get_merged(course, title)
        return {"name": name, "entry": entry}
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")


@app.put("/courses/{course}/merged/{title}/pdf")
async def put_merged_pdf(course: str, title: str, request: Request):
    """Write raw body bytes as a merged PDF under its sanitized title; 404 if the course is missing."""

    try:
        data = await request.body()
        merged.write_merged_pdf(course, title, data)
        broadcast_notify("tree")
        return Response(status_code=204)
    except Exception as e:
        try:
            file = f"{merged.merged_name(title)}.pdf"
        except Exception:  # an unsanitizable title is itself the failure being reported
            file = f"{title.strip()}.pdf"
        return _failure(e, 400, "file_write_failed", {"file": file})


@app.get("/courses/{course}/merged/{title}/pdf")
def get_merged_pdf(course: str, title: str):
    """Stream a merged PDF inline."""

    try:
        name, p = merged.merged_pdf_path(course, title)
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")
    if not p.is_file():
        return _error("Not found", 404, "file_not_found", {"file": f"{name}.pdf"})
    return FileResponse(str(p), media_type="application/pdf")


@app.get("/courses/{course}/merged/{title}/pdf/path")
def get_merged_pdf_path(course: str, title: str):
    """Return a merged PDF's absolute on-disk path, so the launcher can open it in the user's own app."""

    try:
        name, p = merged.merged_pdf_path(course, title)
    except Exception as e:
        return _failure(e, 400, "overview_read_failed")
    if not p.is_file():
        return _error("Not found", 404, "file_not_found", {"file": f"{name}.pdf"})
    return {"path": str(p)}


@app.get("/settings")
def get_settings():
    """Return the browser-dev settings store; the two API keys report set/unset, never a value."""

    try:
        return settings.read_settings()
    except Exception as e:
        return _failure(e, 500, "settings_store_io_failed")


@app.put("/settings")
async def put_settings(request: Request):
    """Merge a partial settings object into the repo-root .env and return the stored view."""

    try:
        body = await request.json()
        return settings.write_settings(body)
    except Exception as e:
        return _failure(e, 400, "settings_store_io_failed")


@app.get("/course_structure")
def get_course_structure():
    """Return the live course-structure mode — what POST /config last set, unlike /settings' .env view."""

    return {"course_structure": tree.course_structure()}


@app.post("/settings/data-root/probe")
async def probe_data_root(request: Request):
    """Judge a candidate {data_root} for the first-run wall without creating or writing anything."""

    try:
        body = await request.json()
        candidate = body["data_root"]
    except Exception as e:
        return _failure(e, 400, "bad_request_body")
    try:
        return {"path": settings.probe_data_root(candidate)}
    except CodedError as e:
        # 422, not 400, so a rejected candidate stays distinct from a malformed body.
        return _failure(e, 422, e.code)


@app.post("/config")
async def post_config(request: Request):
    """Apply {data_root, error_reports, course_structure} to the running process, so a settings change needs no restart."""

    try:
        body = await request.json()
        # Validated before anything applies, so a bad mode cannot leave a half-applied body behind.
        mode = (
            settings.incoming_course_structure(body["course_structure"])
            if body.get("course_structure") is not None
            else None
        )
        if "error_reports" in body:
            # Not an env var: the switch is the Sentry transport gate, so it stops sending from this call on.
            sentry_policy.set_reporting(_bool_field(body, "error_reports"))
        if "data_root" in body:
            # The setter is the only writer of fs.paths' root state, so this takes effect at once.
            root = settings.prepare_data_root(body["data_root"])
            paths.set_data_root(root)
            # lib/sentry's scrubber reads DATA_ROOT from os.environ per event, so it redacts the new root at once.
            os.environ["DATA_ROOT"] = root
        if mode is not None:
            tree.set_course_structure(mode)
        # Every open tree still shows the old root's courses or the old lectures_only flags until it refetches.
        if "data_root" in body or mode is not None:
            broadcast_notify("settings", "tree")
        return Response(status_code=204)
    except Exception as e:
        return _failure(e, 400, "settings_store_io_failed")


@app.get("/events")
async def events():
    """Open a long-lived SSE stream for cross-service notify events."""

    return StreamingResponse(subscribe(), media_type="text/event-stream")


@app.post("/notify")
async def notify(request: Request):
    """Relay the sender's {topics} to every SSE subscriber; a missing or malformed body broadcasts untagged."""

    topics: list[str] = []
    try:
        body = await request.json()
        raw = body.get("topics") if isinstance(body, dict) else None
        if isinstance(raw, list) and all(isinstance(t, str) for t in raw):
            topics = raw
    except Exception:
        pass
    broadcast_notify(*topics)
    return Response(status_code=204)


if __name__ == "__main__":
    runtime.serve(app, default_port=DEFAULT_PORT)
