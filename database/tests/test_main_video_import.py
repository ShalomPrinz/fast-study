"""POST …/video/import: copy or move a local .mp4 in as video.mp4, NDJSON progress, nothing lost on failure."""

import asyncio
import json
import os
import threading

import pytest
from fastapi.testclient import TestClient

URL = "/courses/Algo/lectures/Lecture 1/video/import"


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def notifies(monkeypatch):
    """Record every broadcast_notify call."""

    import database_main

    calls = []
    monkeypatch.setattr(
        database_main, "broadcast_notify", lambda *topics: calls.append(topics)
    )
    return calls


@pytest.fixture
def lecture(data_root):
    """An existing course with a lecture holding an old video and derived files."""

    d = data_root / "Algo" / "Lecture 1"
    d.mkdir(parents=True)
    (d / "video.mp4").write_bytes(b"old")
    (d / "summary.md").write_text("old summary")
    (d / "material.pdf").write_bytes(b"%PDF")
    (d / ".done").touch()
    (d / ".video_source.json").write_text('{"source": "x"}')
    return d


@pytest.fixture
def src(tmp_path):
    """A source .mp4 outside the data root."""

    p = tmp_path / "picked" / "Lecture.MP4"
    p.parent.mkdir()
    p.write_bytes(b"new video bytes")
    return p


def lines(r):
    """Decode the NDJSON body."""

    return [json.loads(x) for x in r.text.splitlines()]


def post(client, path, mode="copy", url=URL):
    """Call the import route."""

    return client.post(url, json={"path": str(path), "mode": mode})


def assert_imported(d):
    """The lecture holds the new video, lost its derived files and kept materials and .done."""

    assert (d / "video.mp4").read_bytes() == b"new video bytes"
    assert sorted(p.name for p in d.iterdir()) == [".done", "material.pdf", "video.mp4"]


def test_copy_keeps_the_original_and_wipes_derived(client, lecture, src, notifies):
    r = post(client, src)

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    assert lines(r)[-1] == {"done": True, "originalKept": False}
    assert_imported(lecture)
    assert src.read_bytes() == b"new video bytes"
    assert notifies == [("tree",)]


def test_copy_streams_throttled_progress(client, lecture, src, monkeypatch):
    from fs import video_import

    monkeypatch.setattr(video_import, "CHUNK", 4)
    monkeypatch.setattr(video_import, "PROGRESS_INTERVAL", 0)

    out = lines(post(client, src))

    assert out[0] == {"copied": 4, "total": 15}
    assert out[-1] == {"done": True, "originalKept": False}


def test_short_copy_emits_the_final_progress_line_before_done(client, lecture, src):
    # One chunk and the default throttle: only the point-of-no-return line can appear.
    assert lines(post(client, src)) == [
        {"copied": 15, "total": 15},
        {"done": True, "originalKept": False},
    ]


def test_same_volume_move_emits_the_final_line_then_done(
    client, lecture, src, notifies
):
    r = post(client, src, "move")

    assert lines(r) == [
        {"copied": 15, "total": 15},
        {"done": True, "originalKept": False},
    ]
    assert_imported(lecture)
    assert not src.exists()
    assert notifies == [("tree",)]


def test_cross_volume_move_copies_then_unlinks(client, lecture, src, monkeypatch):
    from fs import video_import

    monkeypatch.setattr(video_import, "_rename_into", lambda *_: False)

    assert lines(post(client, src, "move"))[-1] == {"done": True, "originalKept": False}
    assert_imported(lecture)
    assert not src.exists()


def test_failed_unlink_still_succeeds_with_original_kept(
    client, lecture, src, monkeypatch
):
    from fs import video_import

    monkeypatch.setattr(video_import, "_rename_into", lambda *_: False)
    real = type(src).unlink

    def deny(self, *a, **k):
        if self == src.resolve():
            raise PermissionError(13, "Permission denied", str(self))
        return real(self, *a, **k)

    monkeypatch.setattr(type(src), "unlink", deny)

    assert lines(post(client, src, "move"))[-1] == {"done": True, "originalKept": True}
    assert_imported(lecture)
    assert src.exists()


def test_locked_wipe_target_refuses_before_any_byte_and_keeps_source(
    client, lecture, src, monkeypatch
):
    from fs import paths

    def locked(_paths):
        raise paths.FileLocked("video.mp4 is open", file="video.mp4")

    monkeypatch.setattr("fs.crud.check_none_locked", locked)

    r = post(client, src, "move")

    assert r.status_code == 423
    assert r.json()["code"] == "file_locked"
    assert src.read_bytes() == b"new video bytes"
    assert (lecture / "video.mp4").read_bytes() == b"old"
    assert not list(lecture.glob(".video.*.tmp"))


def test_wipe_failing_after_a_same_volume_move_puts_the_source_back(
    client, lecture, src, monkeypatch
):
    def boom(*_a):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr("fs.crud.wipe_for_new_video", boom)

    out = lines(post(client, src, "move"))

    assert out[-1]["error"]["code"] == "video_import_failed"
    assert str(src.parent) not in json.dumps(out)
    assert src.read_bytes() == b"new video bytes"
    assert (lecture / "video.mp4").read_bytes() == b"old"
    assert not list(lecture.glob(".video.*.tmp"))


def test_cancel_before_the_rename_commits_leaves_source_and_lecture(
    lecture, src, monkeypatch
):
    from fs import video_import

    cancelled, touched, sent = threading.Event(), threading.Event(), []
    real = video_import._rename_into

    def rename_then_cancel(s, t):
        ok = real(s, t)
        cancelled.set()
        return ok

    monkeypatch.setattr(video_import, "_rename_into", rename_then_cancel)

    with pytest.raises(video_import.ImportCancelled):
        video_import._place(
            lecture,
            src.resolve(),
            "move",
            lambda *a: sent.append(a),
            cancelled,
            touched,
        )

    assert sent == []
    assert not touched.is_set()
    assert src.read_bytes() == b"new video bytes"
    assert (lecture / "video.mp4").read_bytes() == b"old"
    assert (lecture / "summary.md").exists()
    assert not list(lecture.glob(".video.*.tmp"))


def _gate_second_read(monkeypatch, video_import):
    """Block the copy worker at its second source read until the returned event is set, so a cancel always lands mid-copy."""

    release = threading.Event()
    real_open = open

    class Gated:
        def __init__(self, f):
            self.f, self.reads = f, 0

        def __enter__(self):
            self.f.__enter__()
            return self

        def __exit__(self, *a):
            return self.f.__exit__(*a)

        def read(self, n):
            self.reads += 1
            if self.reads == 2:
                # The timeout only stops a failing test from hanging on the blocked worker.
                assert release.wait(10)
            return self.f.read(n)

    def gated_open(path, mode="r", *a, **k):
        f = real_open(path, mode, *a, **k)
        return Gated(f) if mode == "rb" else f

    monkeypatch.setattr(video_import, "open", gated_open, raising=False)
    return release


def test_cancel_mid_copy_keeps_old_video_source_and_leaves_no_temp(
    lecture, src, monkeypatch
):
    import database_main
    from fs import video_import

    monkeypatch.setattr(video_import, "CHUNK", 2)
    monkeypatch.setattr(video_import, "PROGRESS_INTERVAL", 0)
    monkeypatch.setattr(database_main, "broadcast_notify", lambda *_: None)
    release = _gate_second_read(monkeypatch, video_import)

    async def go():
        gen = database_main._import_stream(lecture, src.resolve(), "copy")
        first = await gen.__anext__()
        assert "copied" in first
        # What Starlette does when the client disconnects.
        await gen.aclose()
        release.set()
        # The worker stops at its next chunk, on its own thread.
        for _ in range(100):
            if not list(lecture.glob(".video.*.tmp")):
                break
            await asyncio.sleep(0.02)

    asyncio.run(go())

    assert (lecture / "video.mp4").read_bytes() == b"old"
    assert (lecture / "summary.md").exists()
    assert src.read_bytes() == b"new video bytes"
    assert not list(lecture.glob(".video.*.tmp"))


def test_task_cancel_after_placement_still_notifies_tree(lecture, src, monkeypatch):
    import database_main

    calls = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda *t: calls.append(t))
    from fs import video_import

    entered, release = threading.Event(), threading.Event()
    real_place = video_import.place_video

    def gated_place(*a):
        # Held at the point of no return so the cancel always lands after the last cancelled check.
        entered.set()
        assert release.wait(10)
        return real_place(*a)

    monkeypatch.setattr(video_import, "place_video", gated_place)

    async def go():
        gen = database_main._import_stream(lecture, src.resolve(), "move")
        consumer = asyncio.ensure_future(gen.__anext__())
        # The final progress line is queued before place_video is entered, so the consumer has it by now.
        # Cancelling only once the worker is inside place_video is provably past the last check.
        assert await asyncio.to_thread(entered.wait, 10)
        consumer.cancel()
        await asyncio.gather(consumer, return_exceptions=True)
        await gen.aclose()
        release.set()
        await asyncio.sleep(0.5)

    asyncio.run(go())

    assert (lecture / "video.mp4").read_bytes() == b"new video bytes"
    assert calls == [("tree",)]


def test_failure_after_the_wipe_started_notifies_tree(
    client, lecture, src, notifies, monkeypatch
):
    real = os.replace

    def fail_final(a, b):
        if str(b).endswith("video.mp4"):
            raise OSError(5, "Input/output error")
        return real(a, b)

    monkeypatch.setattr("fs.crud.os.replace", fail_final)

    out = lines(post(client, src))

    assert out[-1]["error"]["code"] == "video_import_failed"
    assert notifies == [("tree",)]


def test_failure_before_the_wipe_does_not_notify(
    client, lecture, src, notifies, monkeypatch
):
    from fs import paths

    def locked(_paths):
        raise paths.FileLocked("video.mp4 is open", file="video.mp4")

    # Passes the early probe, fails the placement's own probe.
    calls = iter([None])

    def probe(p):
        if next(calls, "late") is None:
            return
        locked(p)

    monkeypatch.setattr("fs.crud.check_none_locked", probe)
    out = lines(post(client, src))
    assert out[-1]["error"]["code"] == "file_locked"
    assert notifies == []


def test_concurrent_placements_use_distinct_temp_files(lecture):
    from fs.paths import new_video_tmp

    a, b = new_video_tmp(lecture), new_video_tmp(lecture)

    assert a != b
    assert a.name.startswith(".video.") and a.name.endswith(".tmp")


def test_unrestorable_move_keeps_the_temp_and_names_it(
    client, lecture, src, monkeypatch
):
    real = os.replace

    def boom(_d, *_a):
        raise PermissionError(13, "Permission denied")

    def no_putback(a, b):
        if str(b) == str(src.resolve()):
            raise OSError(5, "gone")
        return real(a, b)

    monkeypatch.setattr("fs.crud.wipe_for_new_video", boom)
    monkeypatch.setattr("fs.video_import.os.replace", no_putback)

    err = lines(post(client, src, "move"))[-1]["error"]

    assert err["code"] == "import_source_stranded"
    kept = lecture / err["params"]["kept"]
    assert kept.read_bytes() == b"new video bytes"
    assert str(src.parent) not in json.dumps(err)


@pytest.mark.parametrize(
    "make, code",
    [
        (lambda t: t / "nope.mp4", "import_source_missing"),
        (lambda t: t, "import_source_not_a_file"),
        (lambda t: _file(t / "a.mkv"), "import_source_not_mp4"),
        (lambda t: _file(t / "a.mp4.txt"), "import_source_not_mp4"),
    ],
)
def test_source_refusals_are_coded_400_and_touch_nothing(
    client, lecture, tmp_path, make, code
):
    r = post(client, make(tmp_path))

    assert r.status_code == 400
    assert r.json()["code"] == code
    assert str(tmp_path) not in json.dumps(r.json())
    assert (lecture / "video.mp4").read_bytes() == b"old"


def _file(p):
    """Create a small file and return its path."""

    p.write_bytes(b"x")
    return p


def test_symlink_named_mp4_to_another_file_is_refused(client, lecture, tmp_path):
    target = _file(tmp_path / "secret.txt")
    link = tmp_path / "x.mp4"
    link.symlink_to(target)

    assert post(client, link).json()["code"] == "import_source_not_mp4"


def test_relative_path_is_refused(client, lecture):
    r = client.post(URL, json={"path": "video.mp4", "mode": "copy"})

    assert r.json()["code"] == "import_source_missing"


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads anything")
def test_unreadable_source_is_refused(client, lecture, src):
    src.chmod(0)

    assert post(client, src).json()["code"] == "import_source_unreadable"


def test_unknown_mode_is_refused(client, lecture, src):
    r = post(client, src, "link")

    assert r.status_code == 400
    assert r.json()["code"] == "import_mode_unknown"
    assert r.json()["params"] == {"mode": "link"}


def test_missing_body_fields_are_bad_request_body(client, lecture):
    r = client.post(URL, json={"mode": "copy"})

    assert r.json()["code"] == "bad_request_body"


def test_source_that_is_the_lectures_own_video_is_refused(client, lecture):
    r = post(client, lecture / "video.mp4", "move")

    assert r.status_code == 400
    assert r.json()["code"] == "import_source_is_target"
    assert (lecture / "video.mp4").read_bytes() == b"old"


def test_reserved_name_is_409(client, data_root, src):
    (data_root / "Algo").mkdir()

    r = post(client, src, url="/courses/Algo/lectures/overview/video/import")

    assert r.status_code == 409
    assert r.json()["code"] == "name_reserved"


def test_missing_course_is_404_and_creates_nothing(client, data_root, src):
    r = post(client, src)

    assert r.status_code == 404
    assert r.json()["code"] == "course_not_found"
    assert list(data_root.iterdir()) == []


def test_new_lecture_dir_is_made_on_demand_and_recitation_kind_works(
    client, data_root, src
):
    (data_root / "Algo").mkdir()

    r = post(client, src, url="/courses/Algo/lectures/R1/video/import?kind=recitation")

    assert lines(r)[-1]["done"] is True
    d = data_root / "Algo" / "Recitations" / "R1"
    assert (d / "video.mp4").read_bytes() == b"new video bytes"
    assert not (d / ".video_source.json").exists()


def test_non_object_body_is_bad_request_body(client, lecture):
    for raw in ("[]", '"x"', "5"):
        r = client.post(URL, content=raw, headers={"content-type": "application/json"})
        assert r.status_code == 400
        assert r.json()["code"] == "bad_request_body"


NEW = "/courses/Algo/lectures/Fresh/video/import"


@pytest.fixture
def course(data_root):
    """A course with no lectures."""

    (data_root / "Algo").mkdir()
    return data_root / "Algo"


def test_failed_import_into_a_new_lecture_leaves_no_folder(
    client, course, src, monkeypatch
):
    def boom(*_a):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr("fs.crud.wipe_for_new_video", boom)

    out = lines(post(client, src, "copy", NEW))

    assert out[-1]["error"]["code"] == "video_import_failed"
    assert list(course.iterdir()) == []


def test_failed_import_keeps_a_preexisting_empty_lecture(
    client, course, src, monkeypatch
):
    (course / "Fresh").mkdir()

    def boom(*_a):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr("fs.crud.wipe_for_new_video", boom)
    post(client, src, "copy", NEW)

    assert (course / "Fresh").is_dir()


def test_cancel_into_a_new_lecture_leaves_no_folder(course, src, monkeypatch):
    import database_main
    from fs import video_import

    monkeypatch.setattr(video_import, "CHUNK", 2)
    monkeypatch.setattr(video_import, "PROGRESS_INTERVAL", 0)
    monkeypatch.setattr(database_main, "broadcast_notify", lambda *_: None)
    release = _gate_second_read(monkeypatch, video_import)
    d, s = video_import.prepare_import("Algo", "Fresh", "lecture", str(src), "copy")

    async def go():
        gen = database_main._import_stream(d, s, "copy")
        await gen.__anext__()
        await gen.aclose()
        release.set()
        for _ in range(100):
            if not d.exists():
                break
            await asyncio.sleep(0.02)

    asyncio.run(go())

    assert not d.exists()


def _cancelled_run(d, s):
    """Run an import that is already cancelled, so it fails before placing anything."""

    from fs import video_import

    ev = threading.Event()
    ev.set()
    with pytest.raises(video_import.ImportCancelled):
        video_import.run_import(d, s, "copy", lambda *_: None, ev, threading.Event())


def test_put_adopts_a_dir_an_import_made(course, src):
    from fs import crud, video_import

    d, s = video_import.prepare_import("Algo", "Fresh", "lecture", str(src), "copy")
    assert crud.prepare_video_dir("Algo", "Fresh", "lecture") == d
    _cancelled_run(d, s)

    assert d.is_dir()


def test_create_lecture_adopts_a_dir_an_import_made(course, src):
    from fs import crud, video_import
    from fs.paths import NameTaken

    d, s = video_import.prepare_import("Algo", "Fresh", "lecture", str(src), "copy")
    with pytest.raises(NameTaken):
        crud.create_lecture("Algo", "Fresh", "lecture")
    _cancelled_run(d, s)

    assert d.is_dir()


def test_second_import_survives_the_first_failing(course, src, monkeypatch):
    from fs import video_import

    monkeypatch.setattr("fs.crud.wipe_for_new_video", lambda *_a, **_k: None)
    d, s = video_import.prepare_import("Algo", "Fresh", "lecture", str(src), "copy")
    d2, s2 = video_import.prepare_import("Algo", "Fresh", "lecture", str(src), "copy")
    _cancelled_run(d, s)
    assert d.is_dir()

    video_import.run_import(
        d2, s2, "copy", lambda *_: None, threading.Event(), threading.Event()
    )

    assert (d / "video.mp4").is_file()


def test_lone_failed_import_removes_its_new_folder(course, src):
    from fs import video_import

    d, s = video_import.prepare_import("Algo", "Fresh", "lecture", str(src), "copy")
    _cancelled_run(d, s)

    assert not d.exists()


def test_response_never_iterated_still_drops_the_claimed_dir(course, src, monkeypatch):
    import database_main
    from fs import crud, video_import

    monkeypatch.setattr(database_main, "broadcast_notify", lambda *_: None)

    def fail(*_a):
        raise OSError(5, "boom")

    monkeypatch.setattr(video_import, "_place", fail)
    d, s = video_import.prepare_import("Algo", "Fresh", "lecture", str(src), "copy")

    async def go():
        # The response is built but the client leaves before the first iteration.
        database_main._import_stream(d, s, "copy")
        while database_main._import_tasks:
            await asyncio.sleep(0.01)

    asyncio.run(go())

    assert not d.exists()
    assert not crud._fresh


def test_blocked_source_check_does_not_freeze_the_loop(
    data_root, lecture, src, monkeypatch
):
    """/health answers while the source check is stuck; only then is the check released."""

    import database_main
    import httpx
    from fs import video_import

    entered, release = threading.Event(), threading.Event()
    released_by_test = []
    real = video_import.check_source

    def slow(raw, mode):
        """Block like a TCC-gated stat until the test releases it (bounded, so a frozen loop fails instead of hanging)."""

        entered.set()
        released_by_test.append(release.wait(5))
        return real(raw, mode)

    monkeypatch.setattr(video_import, "check_source", slow)

    async def run():
        """Start the import, probe /health while the check is still blocked, then release it."""

        transport = httpx.ASGITransport(app=database_main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            imp = asyncio.ensure_future(
                c.post(URL, json={"path": str(src), "mode": "copy"})
            )
            reached = await asyncio.to_thread(entered.wait, 5)
            assert reached, "route never reached check_source"
            health = await asyncio.wait_for(c.get("/health"), 2)
            assert not release.is_set()
            release.set()
            return health, await asyncio.wait_for(imp, 10)

    health, r = asyncio.run(run())
    assert released_by_test == [True], "check timed out: the loop was frozen"
    assert health.status_code == 200
    assert r.status_code == 200
    assert lines(r)[-1]["done"] is True
