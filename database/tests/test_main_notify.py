"""Tree-visible mutations broadcast exactly one tagged notify on success and none on failure."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def notifies(monkeypatch):
    """Record the topics of each broadcast_notify call made by the routes."""

    import database_main

    calls = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda *t: calls.append(t))
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
        ("patch", "/courses/Algo/lectures_only", {"lectures_only": True}),
        ("post", "/courses/Algo/lectures", {"name": "L2"}),
        ("post", "/courses/Algo/lectures?kind=recitation", {"name": "R2"}),
        ("patch", "/courses/Algo/lectures/L1", {"name": "L9"}),
        ("patch", "/courses/Algo/lectures/R1?kind=recitation", {"name": "R9"}),
    ],
)
def test_tree_mutation_notifies_once(client, seeded, notifies, method, url, body):
    r = getattr(client, method)(url, json=body)
    assert r.is_success  # renames and lecture creates answer 200 {name}, the rest 204
    assert notifies == [("tree",)]


@pytest.mark.parametrize(
    "method,url,body",
    [
        ("post", "/courses", {"name": "Algo"}),
        ("patch", "/courses/Missing", {"name": "X"}),
        ("patch", "/courses/Algo/lectures_only", {}),
        ("patch", "/courses/Missing/lectures_only", {"lectures_only": True}),
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
    assert notifies == [("settings", "tree")]


def test_config_without_data_root_does_not_notify(client, notifies):
    assert client.post("/config", json={}).status_code == 204
    assert notifies == []


def test_config_rejected_data_root_does_not_notify(client, notifies):
    r = client.post("/config", json={"data_root": "relative/path"})
    assert r.status_code == 400
    assert notifies == []


def test_summary_write_notifies_once(client, seeded, notifies):
    r = client.put("/courses/Algo/lectures/L1/summary", content="# x".encode())
    assert r.status_code == 204
    assert notifies == [("tree",)]


def test_summary_revert_notifies_once(client, seeded, notifies):
    client.put("/courses/Algo/lectures/L1/summary", content=b"# a")
    client.put("/courses/Algo/lectures/L1/summary", content=b"# b")
    notifies.clear()
    r = client.delete("/courses/Algo/lectures/L1/summary")
    assert r.status_code == 204
    assert notifies == [("tree",)]


def test_failed_summary_write_does_not_notify(client, seeded, notifies):
    r = client.put("/courses/Algo/lectures/Missing/summary", content=b"# x")
    assert r.status_code >= 400
    assert notifies == []


def test_config_course_structure_notifies_once(client, notifies):
    r = client.post("/config", json={"course_structure": "lectures_all"})
    assert r.status_code == 204
    assert notifies == [("settings", "tree")]


def test_config_rejected_course_structure_does_not_notify(client, notifies):
    r = client.post("/config", json={"course_structure": "sideways"})
    assert r.status_code == 400
    assert notifies == []


def test_config_error_reports_does_not_notify(client, notifies):
    assert client.post("/config", json={"error_reports": False}).status_code == 204
    assert notifies == []


@pytest.mark.parametrize(
    "kwargs,expected",
    [
        ({"json": {"topics": ["runner", "tree"]}}, [("runner", "tree")]),
        ({"json": {"topics": ["bogus"]}}, [("bogus",)]),
        ({"json": {"topics": []}}, [()]),
        ({"json": {"topics": "tree"}}, [()]),
        ({"json": {"topics": ["tree", 3]}}, [()]),
        ({"json": ["tree"]}, [()]),
        ({"content": b""}, [()]),
        ({}, [()]),
        ({"content": b"{not json"}, [()]),
    ],
)
def test_post_notify_relays_topics(client, notifies, kwargs, expected):
    assert client.post("/notify", **kwargs).is_success
    assert notifies == expected


def test_broadcast_notify_wire_format():
    import asyncio

    from events import sse

    q: asyncio.Queue = asyncio.Queue()
    sse._subscribers.add(q)
    try:
        sse.broadcast_notify()
        sse.broadcast_notify("runner", "tree", "runner")
        assert q.get_nowait() == "event: notify\ndata: {}\n\n"
        assert q.get_nowait() == 'event: notify\ndata: {"topics":["runner","tree"]}\n\n'
    finally:
        sse._subscribers.discard(q)
