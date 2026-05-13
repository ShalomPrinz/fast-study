import os

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from fs import crud, summary as summary_fs, tree
from fs.files import file_path
from events.sse import subscribe, broadcast_notify

load_dotenv()
DATA_ROOT = os.environ["DATA_ROOT"]

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ok(error: str | None = None, status: int = 200):
    if error is not None:
        return JSONResponse({"ok": False, "error": error}, status_code=status)
    return JSONResponse({"ok": True})


@app.get("/tree")
def get_tree():
    return tree.read_tree()


@app.get("/courses/{course}")
def get_course(course: str):
    return tree.read_course(course)


@app.post("/courses")
async def post_course(request: Request):
    try:
        body = await request.json()
        crud.create_course(body["name"])
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.patch("/courses/{course}")
async def patch_course(course: str, request: Request):
    try:
        body = await request.json()
        crud.rename_course(course, body["name"])
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.post("/courses/{course}/lectures")
async def post_lecture(course: str, request: Request, kind: str = Query("lecture")):
    try:
        body = await request.json()
        crud.create_lecture(course, body["name"], kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.patch("/courses/{course}/lectures/{lecture}")
async def patch_lecture(course: str, lecture: str, request: Request, kind: str = Query("lecture")):
    try:
        body = await request.json()
        crud.rename_lecture(course, lecture, body["name"], kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.put("/courses/{course}/lectures/{lecture}/video")
async def put_video(course: str, lecture: str, request: Request, kind: str = Query("lecture")):
    try:
        data = await request.body()
        crud.write_video(course, lecture, kind, data)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.delete("/courses/{course}/lectures/{lecture}/files/{name}")
def delete_file_endpoint(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    try:
        crud.delete_file(course, lecture, name, kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 400)


@app.get("/courses/{course}/lectures/{lecture}/summary")
def get_summary(course: str, lecture: str, kind: str = Query("lecture")):
    try:
        return summary_fs.read_summary(course, lecture, kind)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.put("/courses/{course}/lectures/{lecture}/summary")
async def put_summary(course: str, lecture: str, request: Request, kind: str = Query("lecture")):
    try:
        content = (await request.body()).decode("utf-8")
        summary_fs.write_summary(course, lecture, kind, content)
        return _ok()
    except Exception as e:
        return _ok(str(e), 500)


@app.delete("/courses/{course}/lectures/{lecture}/summary")
def delete_summary(course: str, lecture: str, kind: str = Query("lecture")):
    try:
        summary_fs.revert_summary(course, lecture, kind)
        return _ok()
    except Exception as e:
        return _ok(str(e), 500)


@app.get("/courses/{course}/lectures/{lecture}/files/{name}")
def get_file(course: str, lecture: str, name: str, kind: str = Query("lecture")):
    p = file_path(course, lecture, name, kind)
    if not p.exists():
        return Response("Not found", status_code=404)
    media_type = "application/pdf" if name.endswith(".pdf") else None
    return FileResponse(str(p), media_type=media_type)


@app.get("/events")
async def events():
    return StreamingResponse(subscribe(), media_type="text/event-stream")


@app.post("/notify")
async def notify(request: Request):
    await request.body()
    broadcast_notify()
    return Response(status_code=204)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
