"""HTTP-level checks for GET /courses/{course}/headings: first `#` line per lecture and recitation."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(data_root):
    """TestClient over the app with an empty data root."""

    import database_main

    return TestClient(database_main.app)


def _summary(d, text):
    """Write a summary.md (bytes or str) into a freshly made item dir."""

    d.mkdir(parents=True, exist_ok=True)
    (d / "summary.md").write_bytes(text if isinstance(text, bytes) else text.encode())


def test_heading_found_after_front_text_and_stripped(client, data_root):
    _summary(
        data_root / "Algo" / "L1", "\n\nintro line\n##   Sorting basics  \n# Later\n"
    )
    r = client.get("/courses/Algo/headings")
    assert r.status_code == 200
    assert r.json() == {"headings": {"lecture:L1": "Sorting basics"}}


def test_omits_missing_summary_no_hash_empty_and_undecodable(client, data_root):
    (data_root / "Algo" / "NoSummary").mkdir(parents=True)
    _summary(data_root / "Algo" / "NoHash", "just text\nmore\n")
    _summary(data_root / "Algo" / "Empty", "###   \n")
    _summary(data_root / "Algo" / "Bad", b"\xff\xfe\n# x\n")
    _summary(data_root / "Algo" / "Ok", "# Fine\n")
    assert client.get("/courses/Algo/headings").json() == {
        "headings": {"lecture:Ok": "Fine"}
    }


def test_recitation_key_and_reserved_dirs_skipped(client, data_root):
    _summary(data_root / "Algo" / "Recitations" / "R1", "# Rec heading\n")
    _summary(data_root / "Algo" / "L1", "# Lec heading\n")
    _summary(data_root / "Algo" / "overview", "# Not a lecture\n")
    assert client.get("/courses/Algo/headings").json() == {
        "headings": {"recitation:R1": "Rec heading", "lecture:L1": "Lec heading"}
    }


def test_course_without_items_is_empty_map(client, data_root):
    (data_root / "Algo").mkdir()
    assert client.get("/courses/Algo/headings").json() == {"headings": {}}


def test_missing_course_404(client):
    r = client.get("/courses/Nope/headings")
    assert r.status_code == 404
    assert r.json()["code"] == "course_not_found"
