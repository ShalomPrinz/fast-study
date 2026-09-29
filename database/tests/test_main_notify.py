"""Tree-visible mutations broadcast exactly one notify on success and none on failure."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def notifies(monkeypatch):
    """Count broadcast_notify calls made by the routes."""

    import database_main

    calls = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda: calls.append(1))
    return calls


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def seeded(data_root):
    """A course holding one lecture and one recitation."""

    (data_root / "Algo" / "L1").mkdir(parents=True)
    (data_root / "Algo" / "Recitations" / "R1").mkdir(parents=True)
    return data_root


@pytest.mark.parametrize(
    "method,url,body",
    [
        ("post", "/courses", {"name": "New"}),
        ("patch", "/courses/Algo", {"name": "Algo2"}),
        ("patch", "/courses/Algo/archived", {"archived": True}),
        ("post", "/courses/Algo/lectures", {"name": "L2"}),
        ("post", "/courses/Algo/lectures?kind=recitation", {"name": "R2"}),
        ("patch", "/courses/Algo/lectures/L1", {"name": "L9"}),
        ("patch", "/courses/Algo/lectures/R1?kind=recitation", {"name": "R9"}),
    ],
)
def test_tree_mutation_notifies_once(client, seeded, notifies, method, url, body):
    r = getattr(client, method)(url, json=body)
    assert r.status_code == 204
    assert len(notifies) == 1


@pytest.mark.parametrize(
    "method,url,body",
    [
        ("post", "/courses", {"name": "Algo"}),
        ("patch", "/courses/Missing", {"name": "X"}),
        ("patch", "/courses/Algo/archived", {}),
        ("post", "/courses/Algo/lectures", {"name": "L1"}),
        ("patch", "/courses/Algo/lectures/Missing", {"name": "X"}),
    ],
)
def test_failed_tree_mutation_does_not_notify(
    client, seeded, notifies, method, url, body
):
    r = getattr(client, method)(url, json=body)
    assert r.status_code >= 400
    assert notifies == []


def test_config_data_root_notifies_once(client, tmp_path, notifies):
    r = client.post("/config", json={"data_root": str(tmp_path / "other")})
    assert r.status_code == 204
    assert len(notifies) == 1


def test_config_without_data_root_does_not_notify(client, notifies):
    assert client.post("/config", json={}).status_code == 204
    assert notifies == []


def test_config_rejected_data_root_does_not_notify(client, notifies):
    r = client.post("/config", json={"data_root": "relative/path"})
    assert r.status_code == 400
    assert notifies == []
