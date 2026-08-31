"""HTTP-level checks that a video upload fires exactly one background video-arrived POST."""

import asyncio

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_and_triggers(monkeypatch):
    """TestClient whose background trigger coroutines are captured instead of left to the loop.

    WHY: the task put_video spawns outlives the request, so tests run it explicitly to assert on it.
    """

    import main

    captured = []
    real_create_task = asyncio.create_task

    def fake_create_task(coro, *args, **kwargs):
        if coro.__qualname__.startswith("_notify_video_arrived"):
            captured.append(coro)
            return real_create_task(asyncio.sleep(0))
        return real_create_task(coro, *args, **kwargs)

    monkeypatch.setattr(main.asyncio, "create_task", fake_create_task)
    return TestClient(main.app), captured


@pytest.fixture
def urlopen_calls(monkeypatch):
    """Record every urlopen the trigger makes, returning a stub response."""

    import main

    calls = []

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return b""

    def fake_urlopen(req, timeout=None):
        calls.append((req.full_url, req.get_method(), timeout))
        return _Resp()

    monkeypatch.setattr(main.urllib.request, "urlopen", fake_urlopen)
    return calls


def test_video_upload_posts_arrival_once(client_and_triggers, urlopen_calls):
    import main

    client, captured = client_and_triggers

    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")
    assert r.status_code == 204
    assert len(captured) == 1

    asyncio.run(captured[0])
    assert len(urlopen_calls) == 1
    url, method, timeout = urlopen_calls[0]
    assert url == (
        f"{main.BACKEND_URL}/courses/Algo/lectures/Lecture%201/video-arrived?kind=lecture"
    )
    assert method == "POST"
    assert timeout is None


def test_video_upload_percent_encodes_kind(client_and_triggers, urlopen_calls):
    client, captured = client_and_triggers

    r = client.put(
        "/courses/Algo/lectures/Rec 1/video",
        content=b"\x00mp4",
        params={"kind": "odd kind"},
    )
    assert r.status_code == 204

    asyncio.run(captured[0])
    assert urlopen_calls[0][0].endswith("/video-arrived?kind=odd%20kind")


def test_video_upload_survives_failing_trigger(client_and_triggers, monkeypatch):
    import main

    def boom(req, timeout=None):
        raise OSError("backend down")

    monkeypatch.setattr(main.urllib.request, "urlopen", boom)
    client, captured = client_and_triggers

    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")
    assert r.status_code == 204

    asyncio.run(captured[0])  # swallowed, not raised
