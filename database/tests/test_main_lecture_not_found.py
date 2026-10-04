"""Neutral writes never create a lecture: a missing lecture dir answers 404 lecture_not_found and writes nothing."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


def _assert_not_found(r, course, lecture):
    assert r.status_code == 404
    assert r.json() == {
        "error": f"{course}/{lecture} does not exist",
        "code": "lecture_not_found",
        "params": {"course": course, "lecture": lecture},
    }


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
def test_put_file_on_a_deleted_lecture_is_404_and_leaves_no_ghost(
    client, data_root, kind
):
    # The course survives the delete; only the lecture dir is gone.
    (data_root / "Algo").mkdir()

    r = client.put(
        f"/courses/Algo/lectures/L1/files/summary.pdf?kind={kind}", content=b"%PDF"
    )

    _assert_not_found(r, "Algo", "L1")
    assert list((data_root / "Algo").rglob("*")) == []


def test_put_file_on_a_missing_course_is_404(client, data_root):
    r = client.put("/courses/Algo/lectures/L1/files/audio.mp3", content=b"ID3")

    _assert_not_found(r, "Algo", "L1")
    assert list(data_root.iterdir()) == []


def test_put_file_on_an_existing_lecture_still_writes(client, data_root):
    (data_root / "Algo" / "L1").mkdir(parents=True)

    r = client.put("/courses/Algo/lectures/L1/files/audio.mp3", content=b"ID3")

    assert r.status_code == 204
    assert (data_root / "Algo" / "L1" / "audio.mp3").read_bytes() == b"ID3"


@pytest.mark.parametrize("fresh", ["false", "true"])
def test_put_summary_on_a_deleted_lecture_is_404(client, data_root, fresh):
    (data_root / "Algo").mkdir()

    r = client.put(f"/courses/Algo/lectures/L1/summary?fresh={fresh}", content=b"# s")

    _assert_not_found(r, "Algo", "L1")
    assert list((data_root / "Algo").iterdir()) == []


def test_put_video_still_creates_a_brand_new_lecture(client, data_root):
    (data_root / "Algo").mkdir()

    r = client.put("/courses/Algo/lectures/L1/video", content=b"\x00mp4")

    assert r.status_code == 204
    assert (data_root / "Algo" / "L1" / "video.mp4").exists()
