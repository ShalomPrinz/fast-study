"""The figures-pending marker: the generic file routes write and delete it, the tree reports it, rename carries it."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


def _entry(client, kind, name):
    """Return one lecture or recitation entry of the Algo course from GET /tree."""

    (course,) = [c for c in client.get("/tree").json() if c["name"] == "Algo"]
    family = course["recitations" if kind == "recitation" else "lectures"]
    (entry,) = [e for e in family if e["name"] == name]
    return entry


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
def test_marker_routes_toggle_the_tree_flag(client, data_root, kind):
    d = data_root / "Algo" / ("Recitations" if kind == "recitation" else "") / "L1"
    d.mkdir(parents=True)
    url = f"/courses/Algo/lectures/L1/files/.figures_pending?kind={kind}"
    assert _entry(client, kind, "L1")["figuresPending"] is False

    assert client.put(url, content=b"").status_code == 204
    assert (d / ".figures_pending").is_file()
    assert _entry(client, kind, "L1")["figuresPending"] is True
    # Never a material.
    assert _entry(client, kind, "L1")["materials"] == []

    assert client.delete(url).status_code == 204
    assert _entry(client, kind, "L1")["figuresPending"] is False


def test_summary_delete_and_video_put_drop_the_marker(client, data_root):
    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    base = "/courses/Algo/lectures/L1"
    (d / ".figures_pending").write_bytes(b"")
    client.delete(f"{base}/files/summary.md")
    assert not (d / ".figures_pending").exists()

    (d / ".figures_pending").write_bytes(b"")
    assert client.put(f"{base}/video", content=b"mp4").status_code == 204
    assert not (d / ".figures_pending").exists()
