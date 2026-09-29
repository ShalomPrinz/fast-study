"""Create, rename and the two uploads that create a dir refuse a lecture/recitation name that lands on a reserved course folder."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


# Case variants count, since NTFS matches folder names case-insensitively; a dropped char still sanitizes onto one.
RESERVED = [
    "overview",
    "Recitations",
    "OVERVIEW",
    "recitations",
    "over:view",
    "overview.",
]


def _assert_reserved(r, name):
    assert r.status_code == 409
    assert r.json() == {
        "error": f"'{name}' is a reserved folder name",
        "code": "name_reserved",
        "params": {"name": name},
    }


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
@pytest.mark.parametrize("name", RESERVED)
def test_create_refuses_a_reserved_name(client, data_root, kind, name):
    (data_root / "Algo").mkdir()

    r = client.post(f"/courses/Algo/lectures?kind={kind}", json={"name": name})

    _assert_reserved(r, name)
    assert [p.name for p in (data_root / "Algo").iterdir()] == []


@pytest.mark.parametrize("name", RESERVED)
def test_rename_refuses_a_reserved_name(client, data_root, name):
    (data_root / "Algo" / "L1").mkdir(parents=True)
    (data_root / "Algo" / "L1" / "material.pdf").write_bytes(b"%PDF")

    r = client.patch("/courses/Algo/lectures/L1", json={"name": name})

    _assert_reserved(r, name)
    assert (data_root / "Algo" / "L1" / "material.pdf").exists()
    assert not (data_root / "Algo" / "overview").exists()


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
@pytest.mark.parametrize("name", RESERVED)
@pytest.mark.parametrize("method, route", [("put", "video"), ("post", "materials")])
def test_uploads_refuse_a_reserved_name(client, data_root, kind, name, method, route):
    (data_root / "Algo").mkdir()

    r = client.request(
        method.upper(),
        f"/courses/Algo/lectures/{name}/{route}?kind={kind}",
        content=b"x",
    )

    _assert_reserved(r, name)
    assert [p.name for p in (data_root / "Algo").iterdir()] == []


@pytest.mark.parametrize("method, route", [("put", "video"), ("post", "materials")])
def test_uploads_still_create_a_new_lecture(client, data_root, method, route):
    (data_root / "Algo").mkdir()

    r = client.request(
        method.upper(), f"/courses/Algo/lectures/New/{route}", content=b"x"
    )

    assert r.status_code in (200, 204)
    assert (data_root / "Algo" / "New").is_dir()


def test_a_name_merely_containing_a_reserved_word_is_fine(client, data_root):
    (data_root / "Algo").mkdir()

    r = client.post("/courses/Algo/lectures", json={"name": "overview 2"})

    assert r.status_code == 204
    assert (data_root / "Algo" / "overview 2").is_dir()


def test_a_course_may_be_named_overview(client, data_root):
    # Course dirs sit alone at the data root, so no reserved folder exists for one to collide with.
    r = client.post("/courses", json={"name": "overview"})

    assert r.status_code == 204
