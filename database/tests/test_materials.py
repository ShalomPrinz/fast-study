"""Material allocation (max+1, never renumber), tree listing, delete, and the video wipe."""

import pytest
from fastapi.testclient import TestClient
from fs import crud
from fs.materials import list_materials, write_material
from fs.paths import lecture_dir


@pytest.fixture
def lecture(data_root):
    """A course with one empty lecture dir, and its path."""

    d = data_root / "Algo" / "Lecture 1"
    d.mkdir(parents=True)
    return d


@pytest.fixture
def client(data_root):
    """TestClient over the app."""

    import main

    return TestClient(main.app)


def test_first_upload_is_unnumbered(lecture):
    assert write_material("Algo", "Lecture 1", "lecture", b"%PDF-1") == "material.pdf"
    assert (lecture / "material.pdf").read_bytes() == b"%PDF-1"


def test_second_upload_gets_index_two(lecture):
    write_material("Algo", "Lecture 1", "lecture", b"a")
    assert write_material("Algo", "Lecture 1", "lecture", b"b") == "material.2.pdf"
    assert (lecture / "material.2.pdf").read_bytes() == b"b"


def test_allocation_after_a_gap_never_backfills(lecture):
    (lecture / "material.pdf").write_bytes(b"a")
    (lecture / "material.3.pdf").write_bytes(b"c")
    assert write_material("Algo", "Lecture 1", "lecture", b"d") == "material.4.pdf"


def test_creates_missing_lecture_dir(data_root):
    assert write_material("Algo", "New", "lecture", b"a") == "material.pdf"
    assert (data_root / "Algo" / "New" / "material.pdf").exists()


def test_post_endpoint_returns_allocated_name(client, lecture):
    r = client.post("/courses/Algo/lectures/Lecture 1/materials", content=b"a")
    assert r.status_code == 200 and r.json() == {"name": "material.pdf"}
    r = client.post("/courses/Algo/lectures/Lecture 1/materials", content=b"b")
    assert r.json() == {"name": "material.2.pdf"}


def test_get_endpoint_empty_for_missing_or_bare_lecture(client, lecture):
    assert client.get("/courses/Algo/lectures/Lecture 1/materials").json() == {
        "materials": []
    }
    r = client.get("/courses/Algo/lectures/Nope/materials")
    assert r.status_code == 200 and r.json() == {"materials": []}


def test_get_endpoint_lists_materials(client, lecture):
    write_material("Algo", "Lecture 1", "lecture", b"a")
    write_material("Algo", "Lecture 1", "lecture", b"bb")
    entries = client.get("/courses/Algo/lectures/Lecture 1/materials").json()[
        "materials"
    ]
    assert [e["name"] for e in entries] == ["material.pdf", "material.2.pdf"]
    assert [e["size"] for e in entries] == [1, 2]
    assert all(set(e) == {"name", "size", "mtime"} for e in entries)


def test_get_endpoint_resolves_recitations(client, data_root):
    write_material("Algo", "Rec 1", "recitation", b"a")
    r = client.get("/courses/Algo/lectures/Rec 1/materials?kind=recitation")
    assert [e["name"] for e in r.json()["materials"]] == ["material.pdf"]


def test_listing_is_index_ordered_and_shaped(lecture):
    for data in (b"a", b"bb", b"ccc"):
        write_material("Algo", "Lecture 1", "lecture", data)
    entries = list_materials(lecture)
    assert [e["name"] for e in entries] == [
        "material.pdf",
        "material.2.pdf",
        "material.3.pdf",
    ]
    assert [e["size"] for e in entries] == [1, 2, 3]
    assert all(set(e) == {"name", "size", "mtime"} for e in entries)


def test_tree_materials_empty_when_none(client, lecture):
    course = client.get("/tree").json()[0]
    assert course["lectures"][0]["materials"] == []
    assert "material.pdf" not in course["lectures"][0]["files"]


def test_tree_lists_materials(client, lecture):
    write_material("Algo", "Lecture 1", "lecture", b"a")
    write_material("Algo", "Lecture 1", "lecture", b"bb")
    course = client.get("/tree").json()[0]
    assert [m["name"] for m in course["lectures"][0]["materials"]] == [
        "material.pdf",
        "material.2.pdf",
    ]


def test_delete_leaves_the_others_unrenamed(client, lecture):
    for data in (b"a", b"b", b"c"):
        write_material("Algo", "Lecture 1", "lecture", data)
    r = client.delete("/courses/Algo/lectures/Lecture 1/files/material.2.pdf")
    assert r.status_code == 204
    assert [e["name"] for e in list_materials(lecture)] == [
        "material.pdf",
        "material.3.pdf",
    ]
    assert (lecture / "material.3.pdf").read_bytes() == b"c"


def test_write_video_wipes_every_material(lecture):
    for data in (b"a", b"b", b"c"):
        write_material("Algo", "Lecture 1", "lecture", data)
    crud.write_video("Algo", "Lecture 1", "lecture", b"vid")
    assert list_materials(lecture) == []
    assert (lecture / "video.mp4").read_bytes() == b"vid"


def test_recitation_materials_resolve_under_recitations(data_root):
    write_material("Algo", "Rec 1", "recitation", b"a")
    assert (lecture_dir("Algo", "Rec 1", "recitation") / "material.pdf").exists()
