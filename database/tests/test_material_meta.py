"""Per-material meta (source, filename, attach): recording, listing, delete, video wipe, corrupt sidecar, legacy adoption."""

import json

import pytest
from fastapi.testclient import TestClient
from fs import crud
from fs.materials import list_materials, write_material

URL = "/courses/Algo/lectures/Lecture 1/materials"


@pytest.fixture
def lecture(data_root):
    """A course with one empty lecture dir, and its path."""

    d = data_root / "Algo" / "Lecture 1"
    d.mkdir(parents=True)
    return d


@pytest.fixture
def client(data_root):
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


def _sidecar(d):
    """Read the raw sidecar map."""

    return json.loads((d / ".materials.json").read_text(encoding="utf-8"))


def test_source_is_recorded_and_listed(client, lecture):
    r = client.post(URL, params={"source": "ref-A"}, content=b"%PDF-a")
    assert r.json() == {"name": "material.pdf"}
    assert _sidecar(lecture) == {"material.pdf": {"source": "ref-A"}}
    [entry] = client.get(URL).json()["materials"]
    assert entry["source"] == "ref-A"
    [tree_entry] = client.get("/tree").json()[0]["lectures"][0]["materials"]
    assert tree_entry["source"] == "ref-A"


def test_sourceless_material_has_no_source_key(client, lecture):
    client.post(URL, content=b"a")
    client.post(URL, params={"source": "ref-B"}, content=b"bb")
    entries = client.get(URL).json()["materials"]
    assert set(entries[0]) == {"name", "size", "mtime"}
    assert entries[1]["source"] == "ref-B"
    assert _sidecar(lecture) == {"material.2.pdf": {"source": "ref-B"}}


def test_no_source_writes_no_sidecar(lecture):
    write_material("Algo", "Lecture 1", "lecture", b"a")
    assert not (lecture / ".materials.json").exists()


def test_delete_drops_the_entry(client, lecture):
    write_material("Algo", "Lecture 1", "lecture", b"a", "ref-A")
    write_material("Algo", "Lecture 1", "lecture", b"bb", "ref-B")
    assert (
        client.delete(URL.replace("materials", "files/material.pdf")).status_code == 204
    )
    assert _sidecar(lecture) == {"material.2.pdf": {"source": "ref-B"}}
    client.delete(URL.replace("materials", "files/material.2.pdf"))
    assert not (lecture / ".materials.json").exists()


def test_video_wipe_keeps_the_sidecar(lecture):
    write_material("Algo", "Lecture 1", "lecture", b"a", "ref-A")
    crud.write_video("Algo", "Lecture 1", "lecture", b"vid")
    assert _sidecar(lecture) == {"material.pdf": {"source": "ref-A"}}
    assert list_materials(lecture)[0]["source"] == "ref-A"


@pytest.mark.parametrize("raw", ["{not json", "[1, 2]", '{"material.pdf": 5}'])
def test_corrupt_sidecar_degrades_to_no_sources(client, lecture, raw):
    (lecture / "material.pdf").write_bytes(b"a")
    (lecture / ".materials.json").write_text(raw, encoding="utf-8")
    [entry] = client.get(URL).json()["materials"]
    assert "source" not in entry
    assert client.get("/tree").status_code == 200
    # The next sourced write self-heals the file.
    r = client.post(URL, params={"source": "ref-B"}, content=b"bb")
    assert r.json() == {"name": "material.2.pdf"}
    assert _sidecar(lecture) == {"material.2.pdf": {"source": "ref-B"}}


def test_adoption_tags_an_identical_legacy_file_and_writes_nothing(client, lecture):
    (lecture / "material.pdf").write_bytes(b"other")
    (lecture / "material.2.pdf").write_bytes(b"%PDF-same")
    r = client.post(URL, params={"source": "ref-A"}, content=b"%PDF-same")
    assert r.json() == {"name": "material.2.pdf"}
    assert sorted(p.name for p in lecture.iterdir()) == [
        ".materials.json",
        "material.2.pdf",
        "material.pdf",
    ]
    assert _sidecar(lecture) == {"material.2.pdf": {"source": "ref-A"}}


@pytest.mark.parametrize("existing", [b"%PDF-xyz", b"different bytes"])
def test_adoption_skips_non_identical_bytes(lecture, existing):
    # Same size with different bytes, and a different size, both allocate a new file.
    (lecture / "material.pdf").write_bytes(existing)
    assert (
        write_material("Algo", "Lecture 1", "lecture", b"%PDF-abc", "ref-A")
        == "material.2.pdf"
    )
    assert (lecture / "material.pdf").read_bytes() == existing
    assert _sidecar(lecture) == {"material.2.pdf": {"source": "ref-A"}}


def test_adoption_skips_a_file_that_already_has_a_source(lecture):
    write_material("Algo", "Lecture 1", "lecture", b"same", "ref-A")
    assert (
        write_material("Algo", "Lecture 1", "lecture", b"same", "ref-B")
        == "material.2.pdf"
    )
    assert _sidecar(lecture) == {
        "material.pdf": {"source": "ref-A"},
        "material.2.pdf": {"source": "ref-B"},
    }


def test_repeated_source_appends_even_over_an_identical_legacy_file(lecture):
    write_material("Algo", "Lecture 1", "lecture", b"same", "ref-A")
    (lecture / "material.2.pdf").write_bytes(b"same")
    assert (
        write_material("Algo", "Lecture 1", "lecture", b"same", "ref-A")
        == "material.3.pdf"
    )
    assert _sidecar(lecture) == {
        "material.pdf": {"source": "ref-A"},
        "material.3.pdf": {"source": "ref-A"},
    }


def test_new_file_clears_a_stale_entry_for_its_name(lecture):
    (lecture / ".materials.json").write_text(
        '{"material.pdf": "gone"}', encoding="utf-8"
    )
    assert write_material("Algo", "Lecture 1", "lecture", b"a") == "material.pdf"
    assert not (lecture / ".materials.json").exists()


def test_delete_route_runs_on_the_event_loop():
    # A threadpool delete could interleave its sidecar rewrite with a POST's and drop an entry.
    import inspect

    import database_main

    assert inspect.iscoroutinefunction(database_main.delete_file_endpoint)


def test_sidecar_write_swaps_in_a_whole_file(lecture, monkeypatch):
    import fs.material_meta as ms

    calls = []
    real = ms.os.replace
    monkeypatch.setattr(
        ms.os, "replace", lambda a, b: (calls.append((a, b)), real(a, b))
    )
    write_material("Algo", "Lecture 1", "lecture", b"a", "ref-A")
    assert calls == [(lecture / ".materials.json.tmp", lecture / ".materials.json")]
    assert _sidecar(lecture) == {"material.pdf": {"source": "ref-A"}}
    assert not (lecture / ".materials.json.tmp").exists()


def _fail_replace(monkeypatch):
    """Make every sidecar swap fail as a Windows sharing violation would; returns the restore."""

    import fs.material_meta as ms

    real = ms.os.replace

    def boom(_a, _b):
        raise PermissionError("sharing violation")

    monkeypatch.setattr(ms.os, "replace", boom)
    return lambda: monkeypatch.setattr(ms.os, "replace", real)


def test_failed_sidecar_write_still_saves_the_pdf(client, lecture, monkeypatch):
    _fail_replace(monkeypatch)
    r = client.post(URL, params={"source": "ref-A"}, content=b"%PDF")
    assert r.status_code == 200 and r.json() == {"name": "material.pdf"}
    assert (lecture / "material.pdf").read_bytes() == b"%PDF"
    assert "source" not in client.get(URL).json()["materials"][0]


def test_failed_sidecar_write_on_adoption_still_answers_the_name(
    client, lecture, monkeypatch
):
    (lecture / "material.pdf").write_bytes(b"same")
    _fail_replace(monkeypatch)
    r = client.post(URL, params={"source": "ref-A"}, content=b"same")
    assert r.status_code == 200 and r.json() == {"name": "material.pdf"}
    assert sorted(p.name for p in lecture.iterdir() if not p.name.startswith(".")) == [
        "material.pdf"
    ]


def test_failed_forget_does_not_fail_the_delete(client, lecture, monkeypatch):
    write_material("Algo", "Lecture 1", "lecture", b"a", "ref-A")
    write_material("Algo", "Lecture 1", "lecture", b"bb", "ref-B")
    restore = _fail_replace(monkeypatch)
    r = client.delete(URL.replace("materials", "files/material.2.pdf"))
    assert r.status_code == 204 and not (lecture / "material.2.pdf").exists()
    assert _sidecar(lecture) == {
        "material.pdf": {"source": "ref-A"},
        "material.2.pdf": {"source": "ref-B"},
    }
    # The stale entry is left behind; the next file on that name clears it.
    restore()
    assert write_material("Algo", "Lecture 1", "lecture", b"c") == "material.2.pdf"
    assert _sidecar(lecture) == {"material.pdf": {"source": "ref-A"}}
