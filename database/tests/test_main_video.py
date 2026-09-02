"""HTTP-level checks for the video upload route: bytes on disk, 204 on success, 400 on failure."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import main

    return TestClient(main.app)


def test_put_video_writes_bytes(client, data_root):
    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")
    assert r.status_code == 204
    assert (data_root / "Algo" / "Lecture 1" / "video.mp4").read_bytes() == b"\x00mp4"


def test_put_video_reports_a_failed_write(client, data_root):
    # A course that is a plain file makes the lecture dir uncreatable, so the write raises.
    (data_root / "Algo").write_bytes(b"not a dir")

    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")
    assert r.status_code == 400
    assert "error" in r.json()
