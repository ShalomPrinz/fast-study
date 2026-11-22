"""HTTP-level checks for the course-level merged PDFs: storage, sanitized naming, listing, locks."""

import os
from datetime import datetime, timezone
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from tests.test_main_file_locked import _locked_body, _sharing_violation


@pytest.fixture
def client(data_root):
    """TestClient over the app, with a course holding one lecture and one recitation, each with a summary.pdf."""

    import database_main

    for d in (data_root / "Algo" / "L1", data_root / "Algo" / "Recitations" / "R1"):
        d.mkdir(parents=True)
        (d / "summary.pdf").write_bytes(b"%PDF-")
        os.utime(d / "summary.pdf", (1_000_000, 1_000_000))
    return TestClient(database_main.app)


def _iso(ts: float) -> str:
    """The pdf_mtime string the backend records for an epoch mtime."""

    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _entry(title="Exam", created="2026-01-01T00:00:00+00:00", mtime=1_000_000):
    """A meta entry over L1 (lecture) and R1 (recitation), both recorded at {mtime}."""

    return {
        "title": title,
        "created_at": created,
        "parts": [
            {"name": "L1", "kind": "lecture", "pdf_mtime": _iso(mtime)},
            {"name": "R1", "kind": "recitation", "pdf_mtime": _iso(mtime)},
        ],
    }


def _u(title: str) -> str:
    """Percent-encode a title for a URL path segment, as a real client must (a bare `?` starts the query)."""

    return quote(title, safe="")


def _save(client, title, entry=None, pdf=True):
    """Write a merged entry (and its pdf) through the routes."""

    r = client.patch(
        "/courses/Algo/merged/meta",
        json={"title": title, "entry": entry or _entry(title)},
    )
    assert r.status_code == 204
    if pdf:
        assert (
            client.put(
                f"/courses/Algo/merged/{_u(title)}/pdf", content=b"%PDF-m"
            ).status_code
            == 204
        )


def test_sanitized_titles_collide_on_one_entry(client, data_root):
    _save(client, "Exam: A?", _entry("Exam: A?", created="2026-01-01T00:00:00+00:00"))
    _save(client, "  Exam A ", _entry("Exam A", created="2026-02-01T00:00:00+00:00"))

    items = client.get("/courses/Algo/merged").json()["merged"]
    assert [i["name"] for i in items] == ["Exam A"]
    assert items[0]["title"] == "Exam A"
    assert sorted(p.name for p in (data_root / "Algo/overview/merged").iterdir()) == [
        "Exam A.pdf",
        "meta.json",
    ]


def test_get_resolves_the_sanitized_name(client):
    _save(client, "Exam: A")

    r = client.get(f"/courses/Algo/merged/{_u('Exam: A')}")
    assert r.status_code == 200
    assert r.json()["name"] == "Exam A"
    assert r.json()["entry"]["title"] == "Exam: A"


def test_get_without_entry_or_pdf_is_null_entry(client):
    assert client.get("/courses/Algo/merged/Nope").json() == {
        "name": "Nope",
        "entry": None,
    }
    _save(client, "NoPdf", pdf=False)
    assert client.get("/courses/Algo/merged/NoPdf").json() == {
        "name": "NoPdf",
        "entry": None,
    }


def test_illegal_title_is_400_and_missing_course_404(client):
    r = client.get(f"/courses/Algo/merged/{_u(' ??')}")
    assert r.status_code == 400
    assert r.json()["code"] == "name_has_no_legal_characters"
    r = client.put(f"/courses/Algo/merged/{_u(' ??')}/pdf", content=b"x")
    assert r.status_code == 400
    r = client.patch("/courses/Algo/merged/meta", json={"title": "<>", "entry": {}})
    assert r.status_code == 400

    for r in (
        client.get("/courses/Missing/merged"),
        client.get("/courses/Missing/merged/X"),
        client.put("/courses/Missing/merged/X/pdf", content=b"x"),
        client.patch("/courses/Missing/merged/meta", json={"title": "X", "entry": {}}),
    ):
        assert r.status_code == 404
        assert r.json()["code"] == "course_not_found"


def test_patch_replaces_the_entry_wholly_and_keeps_others(client):
    _save(
        client,
        "A",
        {
            "title": "A",
            "created_at": "2026-01-01T00:00:00+00:00",
            "parts": [],
            "extra": 1,
        },
    )
    _save(client, "B")
    _save(
        client,
        "A",
        {"title": "A", "created_at": "2026-03-01T00:00:00+00:00", "parts": []},
    )

    items = {i["name"]: i for i in client.get("/courses/Algo/merged").json()["merged"]}
    assert set(items) == {"A", "B"}
    assert "extra" not in items["A"]
    assert items["A"]["created_at"] == "2026-03-01T00:00:00+00:00"


def test_corrupt_meta_reads_as_empty_and_heals_on_write(client, data_root):
    _save(client, "A")
    (data_root / "Algo/overview/merged/meta.json").write_text(
        "{not json", encoding="utf-8"
    )

    assert client.get("/courses/Algo/merged").json() == {"merged": []}
    assert client.get("/courses/Algo/merged/A").json()["entry"] is None
    _save(client, "B")
    assert [i["name"] for i in client.get("/courses/Algo/merged").json()["merged"]] == [
        "B"
    ]


def test_bad_patch_bodies_are_400(client):
    for body in (
        {"title": "A"},
        {"entry": {}},
        {"title": 3, "entry": {}},
        {"title": "A", "entry": []},
    ):
        r = client.patch("/courses/Algo/merged/meta", json=body)
        assert r.status_code == 400
        assert r.json()["code"] == "bad_request_body"


def test_listing_enrichment_and_order(client, data_root):
    _save(client, "Old", _entry("Old", created="2026-01-01T00:00:00+00:00"))
    _save(client, "New", _entry("New", created="2026-02-01T00:00:00+00:00"))
    _save(
        client,
        "Hidden",
        _entry("Hidden", created="2026-03-01T00:00:00+00:00"),
        pdf=False,
    )

    items = client.get("/courses/Algo/merged").json()["merged"]
    assert [i["name"] for i in items] == ["New", "Old"]
    new = items[0]
    assert new["stale"] is False
    assert new["parts"][0] == {
        "name": "L1",
        "kind": "lecture",
        "pdf_mtime": _iso(1_000_000),
        "exists": True,
        "current_pdf_mtime": _iso(1_000_000),
    }


def test_stale_when_a_part_pdf_is_newer(client, data_root):
    _save(client, "Exam")
    os.utime(data_root / "Algo/L1/summary.pdf", (2_000_000, 2_000_000))

    item = client.get("/courses/Algo/merged").json()["merged"][0]
    assert item["stale"] is True
    assert item["parts"][0]["current_pdf_mtime"] == _iso(2_000_000)
    assert item["parts"][1]["current_pdf_mtime"] == _iso(1_000_000)


def test_stale_compares_datetimes_not_strings(client):
    # Same instant, different spelling (no microseconds, +00:00 vs Z): lexically different, not stale.
    entry = _entry("Exam")
    entry["parts"][0]["pdf_mtime"] = "1970-01-12T13:46:40Z"
    _save(client, "Exam", entry)

    assert client.get("/courses/Algo/merged").json()["merged"][0]["stale"] is False


def test_missing_part_and_missing_pdf_never_make_stale(client, data_root):
    _save(client, "Exam")
    os.remove(data_root / "Algo/L1/summary.pdf")
    (data_root / "Algo/Recitations/R1/summary.pdf").unlink()
    (data_root / "Algo/Recitations/R1").rmdir()

    item = client.get("/courses/Algo/merged").json()["merged"][0]
    assert item["stale"] is False
    assert item["parts"][0]["exists"] is True
    assert "current_pdf_mtime" not in item["parts"][0]
    assert item["parts"][1]["exists"] is False
    assert "current_pdf_mtime" not in item["parts"][1]


def test_pdf_stream_and_path(client, data_root):
    _save(client, "Exam: 1")

    r = client.get(f"/courses/Algo/merged/{_u('Exam: 1')}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content == b"%PDF-m"
    p = client.get(f"/courses/Algo/merged/{_u('Exam: 1')}/pdf/path").json()["path"]
    assert p == str(data_root / "Algo/overview/merged/Exam 1.pdf")

    for url in ("/courses/Algo/merged/Nope/pdf", "/courses/Algo/merged/Nope/pdf/path"):
        r = client.get(url)
        assert r.status_code == 404
        assert r.json()["code"] == "file_not_found"


def test_writes_notify_once(client, monkeypatch):
    import database_main

    calls = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda: calls.append(1))
    client.patch("/courses/Algo/merged/meta", json={"title": "A", "entry": _entry("A")})
    client.put("/courses/Algo/merged/A/pdf", content=b"x")
    assert len(calls) == 2
    client.put("/courses/Missing/merged/A/pdf", content=b"x")
    assert len(calls) == 2


def test_locked_output_is_423(client, monkeypatch):
    monkeypatch.setattr("pathlib.Path.write_bytes", _sharing_violation)

    r = client.put("/courses/Algo/merged/Exam/pdf", content=b"%PDF-new")
    assert r.status_code == 423
    assert r.json() == _locked_body("Exam.pdf")


def test_tree_and_overview_listing_hide_merged(client, data_root):
    _save(client, "Exam")
    client.put("/courses/Algo/overview/files/exam-hints.pdf", content=b"%PDF-")

    files = client.get("/courses/Algo/overview/files").json()["files"]
    assert [f["name"] for f in files] == ["exam-hints.pdf"]
    course = next(c for c in client.get("/tree").json() if c["name"] == "Algo")
    assert [x["name"] for x in course["lectures"]] == ["L1"]
    assert [x["name"] for x in course["recitations"]] == ["R1"]
