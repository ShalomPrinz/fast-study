"""The course-structure setting: the live mode, the per-course pick and the resolved tree flag."""

import pytest
import settings
from fastapi.testclient import TestClient
from fs import tree


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def courses(data_root):
    """Two courses, only `Picked` carrying the lectures-only marker."""

    (data_root / "Picked").mkdir()
    (data_root / "Picked" / ".lectures_only").touch()
    (data_root / "Plain").mkdir()
    return data_root


def _flags(client) -> dict:
    """Map each course in GET /tree to its lectures_only flag."""

    return {c["name"]: c["lectures_only"] for c in client.get("/tree").json()}


@pytest.mark.parametrize(
    "mode,expected",
    [
        ("split", {"Picked": False, "Plain": False}),
        ("lectures_all", {"Picked": True, "Plain": True}),
        ("lectures_some", {"Picked": True, "Plain": False}),
    ],
)
def test_resolver_combines_mode_and_marker(client, courses, mode, expected):
    tree.set_course_structure(mode)
    assert _flags(client) == expected


def test_config_switches_the_mode_live(client, courses):
    assert _flags(client) == {"Picked": False, "Plain": False}
    assert (
        client.post("/config", json={"course_structure": "lectures_some"}).status_code
        == 204
    )
    assert _flags(client) == {"Picked": True, "Plain": False}


def test_config_refuses_an_unknown_mode_and_keeps_the_old_one(client, courses):
    tree.set_course_structure("lectures_all")
    r = client.post("/config", json={"course_structure": "sideways"})
    assert r.status_code == 400
    assert r.json()["code"] == "setting_invalid_choice"
    assert _flags(client) == {"Picked": True, "Plain": True}


@pytest.mark.parametrize(
    "stored,expected",
    [
        (None, "split"),
        ("", "split"),
        ("bogus", "split"),
        (" Lectures_Some ", "lectures_some"),
    ],
)
def test_stored_mode_falls_back_to_split(stored, expected):
    assert settings.stored_course_structure(stored) == expected


def test_route_toggles_the_marker(client, data_root):
    (data_root / "Algo").mkdir()
    tree.set_course_structure("lectures_some")

    assert (
        client.patch(
            "/courses/Algo/lectures_only", json={"lectures_only": True}
        ).status_code
        == 204
    )
    assert (data_root / "Algo" / ".lectures_only").is_file()
    assert _flags(client) == {"Algo": True}

    assert (
        client.patch(
            "/courses/Algo/lectures_only", json={"lectures_only": False}
        ).status_code
        == 204
    )
    assert not (data_root / "Algo" / ".lectures_only").exists()
    assert _flags(client) == {"Algo": False}


def test_route_on_a_missing_course_is_404_and_writes_nothing(client, data_root):
    r = client.patch("/courses/Algo/lectures_only", json={"lectures_only": True})
    assert r.status_code == 404
    assert r.json()["code"] == "course_not_found"
    assert list(data_root.iterdir()) == []


def test_marker_never_becomes_a_tree_row(client, courses):
    (courses / "Picked" / "L1").mkdir()
    course = next(c for c in client.get("/tree").json() if c["name"] == "Picked")
    assert [lec["name"] for lec in course["lectures"]] == ["L1"]


def test_a_course_rename_keeps_the_pick(client, courses):
    tree.set_course_structure("lectures_some")
    assert client.patch("/courses/Picked", json={"name": "Renamed"}).status_code == 200
    assert (courses / "Renamed" / ".lectures_only").is_file()
    assert _flags(client) == {"Renamed": True, "Plain": False}


def test_get_course_structure_reports_the_live_mode(client):
    assert client.get("/course_structure").json() == {"course_structure": "split"}
    assert (
        client.post("/config", json={"course_structure": "lectures_all"}).status_code
        == 204
    )
    assert client.get("/course_structure").json() == {
        "course_structure": "lectures_all"
    }


@pytest.mark.parametrize(
    "field,marker", [("lectures_only", ".lectures_only"), ("archived", ".archived")]
)
def test_course_flag_patch_refuses_a_non_bool(client, courses, field, marker):
    r = client.patch(f"/courses/Plain/{field}", json={field: "false"})
    assert r.status_code == 400
    assert r.json()["code"] == "setting_must_be_boolean"
    assert r.json()["params"] == {"field": field}
    assert not (courses / "Plain" / marker).exists()
