"""Materials of any extension: naming, allocation, filename, attach flag, legacy sidecar, summary-materials record."""

import json

import pytest
from fastapi.testclient import TestClient
from fs import crud
from fs.materials import list_materials, material_names
from fs.paths import material_index, material_name

URL = "/courses/Algo/lectures/L1"


@pytest.fixture
def lecture(data_root):
    """A course with one empty lecture dir, and its path."""

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    return d


@pytest.fixture
def client(data_root):
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.mark.parametrize("ext", [".pdf", ".pptx", ".7z"])
def test_name_index_round_trip(ext):
    assert material_name(1, ext) == f"material{ext}"
    assert material_name(5, ext) == f"material.5{ext}"
    assert material_index(material_name(1, ext)) == 1
    assert material_index(material_name(5, ext)) == 5


def test_name_lowercases_ext():
    assert material_name(2, ".PPTX") == "material.2.pptx"


@pytest.mark.parametrize(
    "name",
    [
        "material.2",
        "material.toolongext",
        "summary.pdf",
        "material",
        "material.02.pdf",
        "material.1.pdf",
        "material.PDF",
        "material.2.pdf.bak",
    ],
)
def test_not_a_material(name):
    assert material_index(name) is None


def test_allocation_spans_extensions(client, lecture):
    names = [
        client.post(
            f"{URL}/materials", params={"filename": f}, content=b"x" + f.encode()
        ).json()["name"]
        for f in ("a.pdf", "b.PPTX", "c.7z", "d.pdf")
    ]
    assert names == [
        "material.pdf",
        "material.2.pptx",
        "material.3.7z",
        "material.4.pdf",
    ]


def test_collision_lists_deterministically(lecture):
    (lecture / "material.2.pptx").write_bytes(b"a")
    (lecture / "material.2.pdf").write_bytes(b"b")
    assert material_names(lecture) == ["material.2.pdf", "material.2.pptx"]


def test_filename_stored_trimmed_and_capped(client, lecture):
    long = "x" * 300 + ".pptx"
    client.post(f"{URL}/materials", params={"filename": f"  {long}  "}, content=b"a")
    [entry] = client.get(f"{URL}/materials").json()["materials"]
    assert entry["name"] == "material.pptx"
    assert entry["filename"] == long[:255] and "attach" not in entry
    [tree_entry] = client.get("/tree").json()[0]["lectures"][0]["materials"]
    assert tree_entry == entry


@pytest.mark.parametrize(
    "filename", [None, "", "noext", "a.toolongext", "a.", "a.p-f", "a.001"]
)
def test_no_or_invalid_extension_is_pdf(client, lecture, filename):
    params = {"filename": filename} if filename is not None else {}
    r = client.post(f"{URL}/materials", params=params, content=b"a")
    assert r.json() == {"name": "material.pdf"}


def test_filename_is_never_a_path(client, lecture):
    r = client.post(
        f"{URL}/materials", params={"filename": "../../evil.pptx"}, content=b"a"
    )
    assert r.json() == {"name": "material.pptx"}
    assert (lecture / "material.pptx").exists()


def test_legacy_string_sidecar_reads_as_source(client, lecture):
    (lecture / "material.pdf").write_bytes(b"a")
    (lecture / ".materials.json").write_text('{"material.pdf": "ref-A"}')
    [entry] = client.get(f"{URL}/materials").json()["materials"]
    assert entry["source"] == "ref-A"
    client.patch(f"{URL}/materials/material.pdf", json={"attach": False})
    raw = json.loads((lecture / ".materials.json").read_text())
    assert raw == {"material.pdf": {"source": "ref-A", "attach": False}}


def test_patch_attach_toggles_and_notifies(client, lecture, monkeypatch):
    import database_main

    pings = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda: pings.append(1))
    client.post(f"{URL}/materials", content=b"a")
    r = client.patch(f"{URL}/materials/material.pdf", json={"attach": False})
    assert r.status_code == 204 and pings == [1]
    assert client.get(f"{URL}/materials").json()["materials"][0]["attach"] is False
    client.patch(f"{URL}/materials/material.pdf", json={"attach": True})
    assert client.get(f"{URL}/materials").json()["materials"][0]["attach"] is True


@pytest.mark.parametrize("name", ["material.9.pdf", "summary.pdf", "video.mp4"])
def test_patch_unknown_name_is_404(client, lecture, name):
    (lecture / "summary.pdf").write_bytes(b"a")
    r = client.patch(f"{URL}/materials/{name}", json={"attach": True})
    assert r.status_code == 404
    assert r.json()["code"] == "file_not_found" and r.json()["params"] == {"file": name}


@pytest.mark.parametrize("body", [{"attach": "no"}, {}, [True], {"attach": 1}])
def test_patch_bad_body_is_400(client, lecture, body):
    client.post(f"{URL}/materials", content=b"a")
    r = client.patch(f"{URL}/materials/material.pdf", json=body)
    assert r.status_code == 400 and r.json()["code"] == "bad_request_body"


def test_patch_runs_on_the_event_loop():
    import inspect

    import database_main

    assert inspect.iscoroutinefunction(database_main.patch_material)


def test_delete_drops_the_whole_entry(client, lecture):
    client.post(
        f"{URL}/materials", params={"source": "s", "filename": "a.pptx"}, content=b"a"
    )
    client.patch(f"{URL}/materials/material.pptx", json={"attach": False})
    client.delete(f"{URL}/files/material.pptx")
    assert not (lecture / ".materials.json").exists()


def _tree_summary_materials(client):
    """The lecture's summaryMaterials from the tree."""

    return client.get("/tree").json()[0]["lectures"][0]["summaryMaterials"]


def test_summary_materials_round_trip(client, lecture):
    assert _tree_summary_materials(client) is None
    r = client.put(f"{URL}/summary-materials", json={"materials": ["material.pdf"]})
    assert r.status_code == 204
    assert _tree_summary_materials(client) == ["material.pdf"]
    client.put(f"{URL}/summary-materials", json={"materials": []})
    assert _tree_summary_materials(client) == []


@pytest.mark.parametrize("body", [{"materials": "x"}, {"materials": [1]}, {}, ["a"]])
def test_summary_materials_bad_body_is_400(client, lecture, body):
    r = client.put(f"{URL}/summary-materials", json=body)
    assert r.status_code == 400 and r.json()["code"] == "bad_request_body"


def test_summary_materials_missing_lecture_is_404(client, data_root):
    (data_root / "Algo").mkdir()
    r = client.put(f"{URL}/summary-materials", json={"materials": []})
    assert r.status_code == 404


def test_summary_materials_corrupt_reads_null(client, lecture):
    (lecture / ".summary_materials.json").write_text("{nope")
    assert _tree_summary_materials(client) is None


def test_summary_materials_lifetime(client, lecture):
    (lecture / "summary.md").write_text("s")
    client.put(f"{URL}/summary-materials", json={"materials": ["material.pdf"]})
    client.put(f"{URL}/summary", content="edited".encode())
    assert _tree_summary_materials(client) == ["material.pdf"]
    client.delete(f"{URL}/summary")
    assert _tree_summary_materials(client) == ["material.pdf"]
    client.delete(f"{URL}/files/summary.md")
    assert _tree_summary_materials(client) is None
    client.put(f"{URL}/summary-materials", json={"materials": ["material.pdf"]})
    crud.write_video("Algo", "L1", "lecture", b"vid")
    assert _tree_summary_materials(client) is None


def test_get_file_media_type_by_extension(client, lecture):
    (lecture / "material.png").write_bytes(b"x")
    (lecture / "material.2.txt").write_bytes(b"x")
    assert (
        client.get(f"{URL}/files/material.png").headers["content-type"] == "image/png"
    )
    assert (
        client.get(f"{URL}/files/material.2.txt")
        .headers["content-type"]
        .startswith("text/plain")
    )
    assert list_materials(lecture)[0]["name"] == "material.png"


def test_fresh_summary_drops_the_record_but_edits_keep_it(client, lecture):
    (lecture / "summary.md").write_text("s")
    client.put(f"{URL}/summary-materials", json={"materials": ["material.pdf"]})
    client.put(f"{URL}/summary", content=b"edited")
    assert _tree_summary_materials(client) == ["material.pdf"]
    client.put(f"{URL}/summary", params={"fresh": "true"}, content=b"new")
    assert _tree_summary_materials(client) is None
    assert (lecture / "summary.md").read_text() == "new"


def test_patch_attach_write_failure_is_500_and_silent(client, lecture, monkeypatch):
    import database_main
    import fs.material_meta as mm

    pings = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda: pings.append(1))
    client.post(f"{URL}/materials", content=b"a")
    client.patch(f"{URL}/materials/material.pdf", json={"attach": False})
    before = (lecture / ".materials.json").read_text()
    pings.clear()

    def boom(_a, _b):
        raise PermissionError("sharing violation")

    monkeypatch.setattr(mm.os, "replace", boom)
    r = client.patch(f"{URL}/materials/material.pdf", json={"attach": True})
    assert r.status_code == 500 and r.json()["code"] == "file_write_failed"
    assert r.json()["params"]["file"] == "material.pdf" and pings == []
    assert (lecture / ".materials.json").read_text() == before
