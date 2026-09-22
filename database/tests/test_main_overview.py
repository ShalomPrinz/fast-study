"""HTTP-level checks that the overview endpoints accept a dot-prefixed marker name."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(data_root):
    """TestClient over the app, with a course dir already present."""

    import database_main

    (data_root / "Algo").mkdir()
    return TestClient(database_main.app)


def test_put_and_list_marker_via_http(client, data_root):
    client.put("/courses/Algo/overview/files/exam-hints.pdf", content=b"%PDF-")
    r = client.put(
        "/courses/Algo/overview/files/.exam-hints.pdf_warning", content=b"boom\n"
    )
    assert r.status_code == 204

    files = client.get("/courses/Algo/overview/files").json()["files"]
    assert [f["name"] for f in files] == ["exam-hints.pdf"]
    assert files[0]["warning"] == "boom"


def test_writing_to_a_missing_course_is_404(client):
    r = client.put("/courses/Missing/overview/files/exam.pdf", content=b"%PDF-")

    assert r.status_code == 404
    assert r.json() == {
        "error": "course not found: Missing",
        "code": "course_not_found",
        "params": {"course": "Missing"},
    }


def test_merging_meta_for_a_missing_course_is_404(client):
    r = client.patch("/courses/Missing/overview/meta", json={"slug": "s", "entry": {}})

    assert r.status_code == 404
    assert r.json()["code"] == "course_not_found"


def test_summaries_for_a_missing_course_is_404(client):
    r = client.get("/courses/Missing/summaries")

    assert r.status_code == 404
    assert r.json() == {
        "error": "course not found: Missing",
        "code": "course_not_found",
        "params": {"course": "Missing"},
    }


def test_a_malformed_body_is_a_bad_request(client):
    r = client.patch("/courses/Algo/overview/meta", json={"slug": "s"})

    assert r.status_code == 400
    assert r.json()["code"] == "bad_request_body"
