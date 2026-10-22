"""The studied flag: PUT/DELETE /…/done toggle the .done marker, the tree reports it, and it outlives renames and video uploads."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def notifies(monkeypatch):
    """Count broadcast_notify calls made by the routes."""

    import database_main

    calls = []
    monkeypatch.setattr(database_main, "broadcast_notify", lambda: calls.append(1))
    return calls


def _dir(data_root, kind, name):
    """Resolve a lecture or recitation dir under the Algo course."""

    return data_root / "Algo" / ("Recitations" if kind == "recitation" else "") / name


def _entry(client, kind, name):
    """Return one lecture or recitation entry of the Algo course from GET /tree."""

    (course,) = [c for c in client.get("/tree").json() if c["name"] == "Algo"]
    family = course["recitations" if kind == "recitation" else "lectures"]
    (entry,) = [e for e in family if e["name"] == name]
    return entry


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
def test_set_and_clear_are_idempotent_and_show_on_the_tree(
    client, data_root, notifies, kind
):
    d = _dir(data_root, kind, "L1")
    d.mkdir(parents=True)
    url = f"/courses/Algo/lectures/L1/done?kind={kind}"

    assert _entry(client, kind, "L1")["done"] is False
    for _ in range(2):
        assert client.put(url).status_code == 204
        assert (d / ".done").is_file()
        assert _entry(client, kind, "L1")["done"] is True
    for _ in range(2):
        assert client.delete(url).status_code == 204
        assert not (d / ".done").exists()
        assert _entry(client, kind, "L1")["done"] is False
    assert len(notifies) == 4


@pytest.mark.parametrize("method", ["put", "delete"])
def test_missing_lecture_is_404_and_does_not_notify(
    client, data_root, notifies, method
):
    (data_root / "Algo").mkdir()

    r = getattr(client, method)("/courses/Algo/lectures/L1/done")

    assert r.status_code == 404
    assert r.json()["code"] == "lecture_not_found"
    assert list((data_root / "Algo").iterdir()) == []
    assert notifies == []


def test_done_is_never_a_tree_row(client, data_root):
    (data_root / "Algo" / "L1").mkdir(parents=True)
    client.put("/courses/Algo/lectures/L1/done")

    entry = _entry(client, "lecture", "L1")
    assert ".done" not in entry["files"]
    assert entry["materials"] == []


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
def test_done_survives_rename(client, data_root, kind):
    _dir(data_root, kind, "L1").mkdir(parents=True)
    client.put(f"/courses/Algo/lectures/L1/done?kind={kind}")

    r = client.patch(f"/courses/Algo/lectures/L1?kind={kind}", json={"name": "L2"})

    assert r.status_code == 200
    assert (_dir(data_root, kind, "L2") / ".done").is_file()
    assert _entry(client, kind, "L2")["done"] is True


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
def test_done_survives_a_fresh_video_upload(client, data_root, kind):
    d = _dir(data_root, kind, "L1")
    d.mkdir(parents=True)
    (d / "summary.md").write_text("# old")
    client.put(f"/courses/Algo/lectures/L1/done?kind={kind}")

    r = client.put(f"/courses/Algo/lectures/L1/video?kind={kind}", content=b"\x00mp4")

    assert r.status_code == 204
    assert not (d / "summary.md").exists()
    assert (d / ".done").is_file()
