"""HTTP-level checks for the video upload route: bytes on disk, 204 on success, 400 on failure."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


def test_put_video_writes_bytes(client, data_root):
    (data_root / "Algo").mkdir()
    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")
    assert r.status_code == 204
    assert (data_root / "Algo" / "Lecture 1" / "video.mp4").read_bytes() == b"\x00mp4"


def test_put_video_reports_a_failed_write(client, data_root):
    # A lecture that is a plain file makes the lecture dir uncreatable, so the write raises.
    (data_root / "Algo").mkdir()
    (data_root / "Algo" / "Lecture 1").write_bytes(b"not a dir")

    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")
    assert r.status_code == 400
    assert r.json()["code"] == "file_write_failed"
    assert r.json()["params"]["file"] == "video.mp4"
    # The OS text is the only string that says what went wrong, so it rides as detail.
    assert r.json()["params"]["detail"]


def test_put_video_wipes_derived_files_and_the_summary_snapshot(client, data_root):
    d = data_root / "Algo" / "Lecture 1"
    d.mkdir(parents=True)
    for name in ("transcript.txt", "summary.md", "original_summary.md", "summary.pdf"):
        (d / name).write_bytes(b"old")
    (d / "material.pdf").write_bytes(b"%PDF")

    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")

    assert r.status_code == 204
    # The snapshot belonged to the old video's summary, so "Restore original" must not bring it back.
    assert sorted(p.name for p in d.iterdir()) == ["material.pdf", "video.mp4"]


def test_put_video_on_a_missing_course_is_404_and_creates_nothing(client, data_root):
    # A download still in flight when its course was renamed must not recreate the old name.
    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")

    assert r.status_code == 404
    assert r.json() == {
        "error": "course not found: Algo",
        "code": "course_not_found",
        "params": {"course": "Algo"},
    }
    assert list(data_root.iterdir()) == []


@pytest.mark.parametrize(
    "kind,rel", [("lecture", "Lecture 1"), ("recitation", "Recitations/Lecture 1")]
)
def test_put_video_creates_a_missing_lecture_in_an_existing_course(
    client, data_root, kind, rel
):
    (data_root / "Algo").mkdir()

    r = client.put(
        "/courses/Algo/lectures/Lecture 1/video",
        params={"kind": kind},
        content=b"\x00mp4",
    )

    assert r.status_code == 204
    assert (data_root / "Algo" / rel / "video.mp4").read_bytes() == b"\x00mp4"


def _chunks(n, size):
    """Yield n chunks of size bytes, the body of a streamed upload."""

    for _ in range(n):
        yield b"x" * size


def test_put_video_streams_the_body_in_bounded_writes(client, data_root, monkeypatch):
    import fs.paths as paths

    sizes = []
    real = paths.new_video_tmp

    class Recorder:
        """File wrapper recording each write's size."""

        def __init__(self, f):
            self.f = f

        def write(self, b):
            sizes.append(len(b))
            return self.f.write(b)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.f.close()

    import builtins

    real_open = builtins.open

    def spy_open(file, mode="r", *a, **k):
        f = real_open(file, mode, *a, **k)
        return Recorder(f) if str(file).endswith(".tmp") and "w" in mode else f

    monkeypatch.setattr("database_main.open", spy_open, raising=False)

    # TestClient hands the app one coalesced body, so feed the route the chunk stream a real server delivers.
    async def stream(self):
        for c in _chunks(256, 64 * 1024):
            yield c

    monkeypatch.setattr("starlette.requests.Request.stream", stream)
    assert real  # new_video_tmp stays the shared helper
    (data_root / "Algo").mkdir()
    r = client.put("/courses/Algo/lectures/L1/video", content=_chunks(256, 64 * 1024))
    assert r.status_code == 204
    assert sum(sizes) == 256 * 64 * 1024
    assert len(sizes) > 1 and max(sizes) < sum(sizes) / 2
    assert (data_root / "Algo" / "L1" / "video.mp4").stat().st_size == 256 * 64 * 1024
    assert not list((data_root / "Algo" / "L1").glob(".video.*.tmp"))


def test_put_video_disconnect_mid_body_leaves_the_lecture_untouched(
    client, data_root, monkeypatch
):
    from starlette.requests import ClientDisconnect, Request

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    (d / "video.mp4").write_bytes(b"old")
    (d / "summary.md").write_text("keep")

    async def broken(self):
        yield b"partial"
        raise ClientDisconnect()

    monkeypatch.setattr(Request, "stream", broken)
    client.put("/courses/Algo/lectures/L1/video", content=b"new")
    assert (d / "video.mp4").read_bytes() == b"old"
    assert (d / "summary.md").read_text() == "keep"
    assert [p.name for p in d.iterdir()] == ["video.mp4", "summary.md"] or sorted(
        p.name for p in d.iterdir()
    ) == ["summary.md", "video.mp4"]


def test_put_video_disconnect_on_a_new_lecture_leaves_no_dir(
    client, data_root, monkeypatch
):
    from starlette.requests import ClientDisconnect, Request

    (data_root / "Algo").mkdir()

    async def broken(self):
        raise ClientDisconnect()
        yield b""

    monkeypatch.setattr(Request, "stream", broken)
    client.put("/courses/Algo/lectures/New/video", content=b"new")
    assert not (data_root / "Algo" / "New").exists()


def test_put_video_locked_wipe_target_is_423_and_removes_the_temp(
    client, data_root, monkeypatch
):
    from fs import crud
    from fs.paths import FileLocked

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    (d / "video.mp4").write_bytes(b"old")
    calls = {"n": 0}

    def locked_late(_d):
        calls["n"] += 1
        if calls["n"] > 1:
            raise FileLocked("summary.pdf")

    monkeypatch.setattr(crud, "check_none_locked", lambda *_: None)
    monkeypatch.setattr(crud, "check_video_wipe_unlocked", lambda _d: None)
    monkeypatch.setattr(
        crud,
        "wipe_for_new_video",
        lambda *_a, **_k: locked_late(None) or locked_late(None),
    )
    r = client.put("/courses/Algo/lectures/L1/video", content=b"new")
    assert r.status_code == 423
    assert (d / "video.mp4").read_bytes() == b"old"
    assert not list(d.glob(".video.*.tmp"))


def test_put_video_success_on_a_new_lecture_logs_no_warning(client, data_root, caplog):
    (data_root / "Algo").mkdir()
    with caplog.at_level("WARNING"):
        r = client.put("/courses/Algo/lectures/New/video", content=b"\x00mp4")
    assert r.status_code == 204
    assert "cleanup failed" not in caplog.text
    assert sorted(p.name for p in (data_root / "Algo").iterdir()) == ["New"]


def test_put_video_disconnect_never_creates_the_lecture_dir(
    client, data_root, monkeypatch
):
    from starlette.requests import ClientDisconnect, Request

    (data_root / "Algo").mkdir()

    async def broken(self):
        yield b"partial"
        raise ClientDisconnect()

    monkeypatch.setattr(Request, "stream", broken)
    r = client.put("/courses/Algo/lectures/New/video", content=b"new")
    # Nothing exists for a concurrent import to race with, and the temp is gone.
    assert list((data_root / "Algo").iterdir()) == []
    assert r.json()["code"] == "file_write_failed"


def test_put_video_refusal_drains_the_body_before_answering(
    client, data_root, monkeypatch
):
    from starlette.requests import Request

    read = []
    real = Request.stream

    async def spy(self):
        async for c in real(self):
            read.append(len(c))
            yield c

    monkeypatch.setattr(Request, "stream", spy)
    r = client.put("/courses/Algo/lectures/L1/video", content=b"x" * 1000)
    assert r.status_code == 404
    assert r.json()["code"] == "course_not_found"
    assert sum(read) == 1000
    assert list(data_root.iterdir()) == []
