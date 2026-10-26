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
    assert node["assignments"] == [
        {
            "name": "t",
            "done": False,
            "files": [],
            "lectures": [],
            "docs": {"intuition": None, "solution": None},
        }
    ]
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


# --- AI docs: attach switches, course-material selection, generated docs ---

A = "/courses/Algo/assignments/t"


@pytest.fixture
def asg(client, data_root):
    """An assignment `t` holding ex1.pdf, plus lecture L1 and recitation R1 in the course."""

    (data_root / "Algo" / "L1").mkdir()
    (data_root / "Algo" / "Recitations" / "R1").mkdir(parents=True)
    assert _post(client, name="t").status_code == 200
    return data_root / "Algo" / "Assignments" / "t"


def _entry(client):
    return _node(client)["assignments"][0]


def test_attach_default_toggle_and_stale_key(client, asg):
    assert _entry(client)["files"][0]["attach"] is True
    assert client.patch(f"{A}/files/ex1.pdf", json={"attach": False}).status_code == 204
    assert _entry(client)["files"][0]["attach"] is False
    meta = json.loads((asg / ".assignment_meta.json").read_text())
    assert meta == {"attach": {"ex1.pdf": False}}
    assert client.patch(f"{A}/files/ex1.pdf", json={"attach": True}).status_code == 204
    assert _entry(client)["files"][0]["attach"] is True
    assert not (asg / ".assignment_meta.json").exists()
    (asg / ".assignment_meta.json").write_text('{"attach": {"gone.pdf": false}}')
    assert [f["attach"] for f in _entry(client)["files"]] == [True]


def test_attach_errors(client, asg):
    r = client.patch(f"{A}/files/nope.pdf", json={"attach": False})
    assert (r.status_code, r.json()["code"]) == (404, "file_not_found")
    for body in ({"attach": "no"}, {}, [1]):
        r = client.patch(f"{A}/files/ex1.pdf", json=body)
        assert (r.status_code, r.json()["code"]) == (400, "bad_request_body")


def test_lectures_round_trip_and_vanished_dropped(client, asg, data_root):
    sel = [{"name": "R1", "kind": "recitation"}, {"name": "L1", "kind": "lecture"}]
    assert client.put(f"{A}/lectures", json={"lectures": sel}).status_code == 204
    assert _entry(client)["lectures"] == sel
    (data_root / "Algo" / "L1").rmdir()
    assert _entry(client)["lectures"] == sel[:1]
    # A lecture named like a recitation is not the recitation.
    (data_root / "Algo" / "Recitations" / "R1").rmdir()
    assert _entry(client)["lectures"] == []
    for body in ({"lectures": [{"name": "L1"}]}, {"lectures": "x"}, {}):
        r = client.put(f"{A}/lectures", json=body)
        assert (r.status_code, r.json()["code"]) == (400, "bad_request_body")


def test_doc_write_snapshot_restore_and_fresh(client, asg):
    g = asg / ".generated"
    assert client.get(f"{A}/docs/intuition").status_code == 404
    assert client.put(f"{A}/docs/intuition", content="v1".encode()).status_code == 204
    assert client.get(f"{A}/docs/intuition").json() == {
        "content": "v1",
        "hasOriginal": False,
    }
    client.put(f"{A}/docs/intuition", content=b"v2")
    assert client.get(f"{A}/docs/intuition").json() == {
        "content": "v2",
        "hasOriginal": True,
    }
    assert (g / "original_intuition.md").read_text() == "v1"
    assert client.delete(f"{A}/docs/intuition").status_code == 204
    assert client.get(f"{A}/docs/intuition").json() == {
        "content": "v1",
        "hasOriginal": False,
    }
    client.put(f"{A}/docs/intuition", content=b"v2")
    client.put(f"{A}/docs/intuition?fresh=true", content=b"v3")
    assert not (g / "original_intuition.md").exists()
    assert client.get(f"{A}/docs/intuition").json()["content"] == "v3"
    assert client.get(f"{A}/docs/other").status_code == 404
    assert client.put(f"{A}/docs/other", content=b"x").status_code == 404


def test_doc_tree_entry(client, asg):
    assert _entry(client)["docs"] == {"intuition": None, "solution": None}
    client.put(f"{A}/docs/solution", content=b"s")
    client.put(f"{A}/generated/solution.pdf", content=b"%PDF")
    client.put(f"{A}/generated/solution.pdf_warning", content=b"overfull\n")
    doc = _entry(client)["docs"]["solution"]
    assert doc["pdf_warning"] == "overfull"
    assert doc["md_mtime"] > 0 and doc["pdf_mtime"] > 0
    assert _entry(client)["docs"]["intuition"] is None


def test_generated_whitelist_and_bytes(client, asg):
    for bad in ("foo.pdf", "intuition.md", "original_intuition.md"):
        for verb in (client.get, client.delete):
            r = verb(f"{A}/generated/{bad}")
            assert (r.status_code, r.json()["code"]) == (400, "unsafe_path_segment")
        r = client.put(f"{A}/generated/{bad}", content=b"x")
        assert (r.status_code, r.json()["code"]) == (400, "unsafe_path_segment")
    # A slash never reaches the route (the router 404s it); the resolver still refuses it.
    from fs.assignments import generated_path

    with pytest.raises(ValueError):
        generated_path("Algo", "t", "../x")
    assert client.get(f"{A}/generated/intuition.pdf").status_code == 404
    client.put(f"{A}/generated/intuition.pdf", content=b"%PDF")
    assert client.get(f"{A}/generated/intuition.pdf").content == b"%PDF"
    p = client.get(f"{A}/generated/intuition.pdf/path").json()["path"]
    assert p == str(asg / ".generated" / "intuition.pdf")


def test_deleting_pdf_drops_its_warning(client, asg):
    client.put(f"{A}/generated/solution.pdf", content=b"%PDF")
    client.put(f"{A}/generated/solution.pdf_warning", content=b"w")
    client.put(f"{A}/generated/solution.pdf_build.tex", content=b"t")
    assert client.delete(f"{A}/generated/solution.pdf").status_code == 204
    g = asg / ".generated"
    assert not (g / "solution.pdf").exists()
    assert not (g / "solution.pdf_warning").exists()
    assert (g / "solution.pdf_build.tex").exists()
    assert client.delete(f"{A}/generated/solution.pdf").status_code == 204


def test_generated_never_listed_in_files(client, asg):
    client.put(f"{A}/docs/intuition", content=b"x")
    assert [f["name"] for f in _entry(client)["files"]] == ["ex1.pdf"]


def test_missing_assignment_404_everywhere_and_not_created(client, data_root):
    base = "/courses/Algo/assignments/ghost"
    calls = [
        client.put(f"{base}/lectures", json={"lectures": []}),
        client.patch(f"{base}/files/a.pdf", json={"attach": False}),
        client.put(f"{base}/docs/intuition", content=b"x"),
        client.delete(f"{base}/docs/intuition"),
        client.put(f"{base}/generated/intuition.pdf", content=b"x"),
    ]
    for r in calls:
        assert (r.status_code, r.json()["code"]) == (404, "lecture_not_found")
    assert not (data_root / "Algo" / "Assignments" / "ghost").exists()


def test_every_write_notifies(client, asg, monkeypatch):
    import database_main

    hits = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda: hits.append(1))
    client.patch(f"{A}/files/ex1.pdf", json={"attach": False})
    client.put(f"{A}/lectures", json={"lectures": []})
    client.put(f"{A}/docs/intuition", content=b"x")
    client.delete(f"{A}/docs/intuition")
    client.put(f"{A}/generated/intuition.pdf", content=b"x")
    client.delete(f"{A}/generated/intuition.pdf")
    assert len(hits) == 6


def test_generated_writes_404_when_dir_vanishes_after_check(data_root, monkeypatch):
    """A dir removed between the existence check and the mkdir answers LectureNotFound, not a raw error."""

    from fs import assignments
    from fs.paths import LectureNotFound

    (data_root / "Algo").mkdir()
    monkeypatch.setattr(assignments, "_existing_dir", lambda c, n: None)
    with pytest.raises(LectureNotFound):
        assignments.write_doc("Algo", "gone", "solution", "x", False)
    with pytest.raises(LectureNotFound):
        assignments.write_generated("Algo", "gone", "solution.pdf", b"x")


def test_generated_writes_404_when_dir_vanishes_after_mkdir(data_root, monkeypatch):
    """A dir removed after the mkdir makes the write itself fail; that is LectureNotFound too."""

    from fs import assignments
    from fs.paths import LectureNotFound

    (data_root / "Algo").mkdir()
    monkeypatch.setattr(assignments, "_existing_dir", lambda c, n: None)
    monkeypatch.setattr(assignments, "_mkdir_generated", lambda g, c, n: None)
    with pytest.raises(LectureNotFound):
        assignments.write_doc("Algo", "gone", "solution", "x", False)
    with pytest.raises(LectureNotFound):
        assignments.write_generated("Algo", "gone", "solution.pdf", b"x")


def test_fresh_drop_unlink_lock_is_file_locked(tmp_path, monkeypatch):
    """A sharing violation on a drop record after the lock probe is FileLocked, not a raw PermissionError."""

    from fs import summary
    from fs.paths import FileLocked

    rec = tmp_path / ".rec"
    rec.write_text("{}")
    real = type(rec).unlink

    def fake(self, missing_ok=False):
        """Raise a sharing violation for the drop record only."""
        if self.name == ".rec":
            raise PermissionError(13, "x", str(self))
        return real(self, missing_ok=missing_ok)

    monkeypatch.setattr(summary, "check_none_locked", lambda _p: None)
    monkeypatch.setattr(type(rec), "unlink", fake)
    monkeypatch.setattr(
        summary, "reject_if_locked", lambda e, n: (_ for _ in ()).throw(FileLocked(n))
    )
    with pytest.raises(FileLocked):
        summary.write_snapshotted(
            tmp_path / "a.md", tmp_path / "o.md", "x", True, (rec,)
        )
