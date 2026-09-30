"""A course route on a course dir that is gone (renamed outside the app) answers 404 course_not_found."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.mark.parametrize("archived", [True, False])
def test_archive_toggle_on_a_missing_course_is_404_and_writes_nothing(
    client, data_root, archived
):
    r = client.patch("/courses/Algo/archived", json={"archived": archived})

    assert r.status_code == 404
    assert r.json() == {
        "error": "course not found: Algo",
        "code": "course_not_found",
        "params": {"course": "Algo"},
    }
    assert list(data_root.iterdir()) == []


def test_archive_toggle_on_an_existing_course_still_writes(client, data_root):
    (data_root / "Algo").mkdir()

    r = client.patch("/courses/Algo/archived", json={"archived": True})

    assert r.status_code == 204
    assert (data_root / "Algo" / ".archived").is_file()
