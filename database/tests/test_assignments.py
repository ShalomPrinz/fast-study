"""Assignments: reserved name, tree shape, collision allocation, sidecar source, and the path and bytes routes."""

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(data_root):
    """TestClient over the app, with a course dir present."""

    import database_main

    (data_root / "Algo").mkdir()
    return TestClient(database_main.app)


def _post(client, name="תרגיל 1", filename="ex1.pdf", body=b"x", **q):
    return client.post(
        f"/courses/Algo/assignments/{name}/files",
        params={"filename": filename, **q},
        content=body,
    )


def _node(client):
    return next(c for c in client.get("/tree").json() if c["name"] == "Algo")


@pytest.mark.parametrize("name", ["Assignments", "assignments", "ASSIGNMENTS"])
def test_reserved_on_create_and_rename(client, name):
    r = client.post("/courses/Algo/lectures", json={"name": name})
    assert (r.status_code, r.json()["code"]) == (409, "name_reserved")
    client.post("/courses/Algo/lectures", json={"name": "L1"})
    r = client.patch("/courses/Algo/lectures/L1", json={"name": name})
    assert (r.status_code, r.json()["code"]) == (409, "name_reserved")


def test_tree_skips_assignments_as_lecture_and_lists_empty(client, data_root):
    (data_root / "Algo" / "Assignments" / "t").mkdir(parents=True)
    node = _node(client)
    assert node["lectures"] == []
    assert node["assignments"] == [{"name": "t", "done": False, "files": []}]
    (data_root / "Algo" / "Assignments" / "t").rmdir()
    assert _node(client)["assignments"] == []


def test_missing_course_404_and_no_ghost(client, data_root):
    r = client.post(
        "/courses/Nope/assignments/a/files", params={"filename": "f.pdf"}, content=b"x"
    )
    assert (r.status_code, r.json()["code"]) == (404, "course_not_found")
    assert not (data_root / "Nope").exists()


def test_collision_allocates_numbered_names(client, data_root):
    assert _post(client).json() == {"assignment": "תרגיל 1", "name": "ex1.pdf"}
    assert _post(client).json()["name"] == "ex1 (2).pdf"
    assert _post(client).json()["name"] == "ex1 (3).pdf"
    assert _post(client, filename="Makefile").json()["name"] == "Makefile"
    assert _post(client, filename="Makefile").json()["name"] == "Makefile (2)"
    d = data_root / "Algo" / "Assignments" / "תרגיל 1"
    assert (d / "ex1 (3).pdf").read_bytes() == b"x"


@pytest.mark.parametrize(
    "bad", ["../x.pdf", "a/b.pdf", "a\\b.pdf", "..", ".assignment_files.json", ".hid"]
)
def test_unsafe_filename_refused(client, bad):
    r = _post(client, filename=bad)
    assert (r.status_code, r.json()["code"]) == (400, "unsafe_path_segment")


def test_source_recorded_and_omitted_when_absent(client, data_root):
    _post(client, filename="b.pdf", source="ref1")
    _post(client, filename="a.pdf")
    files = _node(client)["assignments"][0]["files"]
    assert [f["name"] for f in files] == ["a.pdf", "b.pdf"]
    assert "source" not in files[0]
    assert files[1]["source"] == "ref1"
    assert (data_root / "Algo/Assignments/תרגיל 1/.assignment_files.json").exists()


def test_dotfiles_hidden(client, data_root):
    _post(client, source="r")
    (data_root / "Algo/Assignments/תרגיל 1/.secret").write_bytes(b"1")
    names = [f["name"] for f in _node(client)["assignments"][0]["files"]]
    assert names == ["ex1.pdf"]


def test_unreadable_sidecar_reads_empty(client, data_root):
    _post(client, source="r")
    (data_root / "Algo/Assignments/תרגיל 1/.assignment_files.json").write_text("{bad")
    assert "source" not in _node(client)["assignments"][0]["files"][0]


def test_path_and_bytes_routes(client, data_root):
    _post(client, body=b"%PDF")
    base = "/courses/Algo/assignments/תרגיל 1/files/ex1.pdf"
    r = client.get(base + "/path")
    assert r.json() == {"path": str(data_root / "Algo/Assignments/תרגיל 1/ex1.pdf")}
    r = client.get(base)
    assert r.content == b"%PDF" and r.headers["content-type"] == "application/pdf"
    for suffix in ("", "/path"):
        r = client.get("/courses/Algo/assignments/תרגיל 1/files/zz.pdf" + suffix)
        assert (r.status_code, r.json()["code"]) == (404, "file_not_found")


@pytest.mark.parametrize(
    ("given", "stored"),
    [
        ("a:b.pdf", "ab.pdf"),
        ("x.pdf.", "x.pdf"),
        ("CON.pdf", "CON_.pdf"),
        ("CON .pdf", "CON _.pdf"),
        ("q?.pdf ", "q.pdf"),
    ],
)
def test_ntfs_names_sanitized(client, data_root, given, stored):
    r = _post(client, filename=given, source="s")
    assert r.json()["name"] == stored
    assert [f["name"] for f in _node(client)["assignments"][0]["files"]] == [stored]
    d = data_root / "Algo/Assignments/תרגיל 1"
    assert (d / stored).exists()
    assert json.loads((d / ".assignment_files.json").read_text()) == {stored: "s"}


@pytest.mark.parametrize("given", ["?", "...", ":.x", ".hid"])
def test_unusable_names_refused(client, given):
    r = _post(client, filename=given)
    assert (r.status_code, r.json()["code"]) == (400, "unsafe_path_segment")


def test_get_sidecar_refused(client):
    _post(client, source="r")
    base = "/courses/Algo/assignments/תרגיל 1/files/.assignment_files.json"
    for suffix in ("", "/path"):
        r = client.get(base + suffix)
        assert (r.status_code, r.json()["code"]) == (400, "unsafe_path_segment")


def test_done_toggle_is_idempotent_listed_in_tree_notifies_and_never_a_file(
    client, data_root, monkeypatch
):
    import database_main

    calls = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda: calls.append(1))
    _post(client)
    calls.clear()
    url = "/courses/Algo/assignments/תרגיל 1/done"
    (a,) = _node(client)["assignments"]
    assert a["done"] is False

    for _ in range(2):
        assert client.put(url).status_code == 204
    assert (data_root / "Algo" / "Assignments" / "תרגיל 1" / ".done").exists()
    (a,) = _node(client)["assignments"]
    assert a["done"] is True
    assert [f["name"] for f in a["files"]] == ["ex1.pdf"]
    assert len(calls) == 2

    for _ in range(2):
        assert client.delete(url).status_code == 204
    assert _node(client)["assignments"][0]["done"] is False
    assert len(calls) == 4


def test_done_missing_assignment_is_404_both_verbs(client):
    for verb in (client.put, client.delete):
        r = verb("/courses/Algo/assignments/nope/done")
        assert (r.status_code, r.json()["code"]) == (404, "lecture_not_found")


def test_upload_into_done_assignment_keeps_the_mark(client):
    _post(client)
    client.put("/courses/Algo/assignments/תרגיל 1/done")
    _post(client, filename="ex2.pdf")
    (a,) = _node(client)["assignments"]
    assert a["done"] is True
    assert [f["name"] for f in a["files"]] == ["ex1.pdf", "ex2.pdf"]
