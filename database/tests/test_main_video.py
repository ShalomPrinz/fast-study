"""HTTP-level checks for the video upload route: bytes on disk, 204 on success, 400 on failure."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


def test_put_video_writes_bytes(client, data_root):
    r = client.put("/courses/Algo/lectures/Lecture 1/video", content=b"\x00mp4")
    assert r.status_code == 204
    assert (data_root / "Algo" / "Lecture 1" / "video.mp4").read_bytes() == b"\x00mp4"


def test_put_video_reports_a_failed_write(client, data_root):
    # A course that is a plain file makes the lecture dir uncreatable, so the write raises.
    (data_root / "Algo").write_bytes(b"not a dir")

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
