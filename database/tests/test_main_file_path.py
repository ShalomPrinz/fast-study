"""HTTP-level checks that the /path routes report absolute on-disk paths and 404 on a missing file."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(data_root):
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


def test_lecture_file_path(client, data_root):
    d = data_root / "Algo" / "Lecture 1"
    d.mkdir(parents=True)
    (d / "summary.pdf").write_bytes(b"%PDF-")

    r = client.get("/courses/Algo/lectures/Lecture 1/files/summary.pdf/path")
    assert r.status_code == 200
    assert r.json() == {"path": str(d / "summary.pdf")}


def test_recitation_file_path(client, data_root):
    d = data_root / "Algo" / "Recitations" / "Rec 1"
    d.mkdir(parents=True)
    (d / "video.mp4").write_bytes(b"mp4")

    r = client.get(
        "/courses/Algo/lectures/Rec 1/files/video.mp4/path",
        params={"kind": "recitation"},
    )
    assert r.status_code == 200
    assert r.json() == {"path": str(d / "video.mp4")}


def test_overview_file_path(client, data_root):
    d = data_root / "Algo" / "overview"
    d.mkdir(parents=True)
    (d / "exam-hints.pdf").write_bytes(b"%PDF-")

    r = client.get("/courses/Algo/overview/files/exam-hints.pdf/path")
    assert r.status_code == 200
    assert r.json() == {"path": str(d / "exam-hints.pdf")}


def test_missing_file_is_404(client, data_root):
    (data_root / "Algo" / "Lecture 1").mkdir(parents=True)

    assert (
        client.get(
            "/courses/Algo/lectures/Lecture 1/files/summary.pdf/path"
        ).status_code
        == 404
    )
    assert (
        client.get("/courses/Algo/overview/files/exam-hints.pdf/path").status_code
        == 404
    )
