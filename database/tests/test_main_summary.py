"""PUT /summary: the editor's write snapshots the original once; a fresh pipeline write drops the snapshot."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def edited(data_root):
    """A lecture whose summary was edited: summary.md holds the edit, original_summary.md the old AI output."""

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    (d / "summary.md").write_text("edited", encoding="utf-8")
    (d / "original_summary.md").write_text("old ai", encoding="utf-8")
    return d


def _summary(client) -> dict:
    return client.get("/courses/Algo/lectures/L1/summary").json()


def test_an_edit_keeps_the_existing_snapshot(client, edited):
    r = client.put("/courses/Algo/lectures/L1/summary", content="edited again".encode())

    assert r.status_code == 204
    assert _summary(client) == {"content": "edited again", "hasOriginal": True}
    assert (edited / "original_summary.md").read_text(encoding="utf-8") == "old ai"


def test_the_first_edit_snapshots_the_pipeline_output(client, data_root):
    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    (d / "summary.md").write_text("ai", encoding="utf-8")

    client.put("/courses/Algo/lectures/L1/summary", content="edited".encode())

    assert (d / "original_summary.md").read_text(encoding="utf-8") == "ai"


def test_a_fresh_write_drops_the_stale_snapshot(client, edited):
    r = client.put(
        "/courses/Algo/lectures/L1/summary?fresh=true", content="new ai".encode()
    )

    assert r.status_code == 204
    assert _summary(client) == {"content": "new ai", "hasOriginal": False}


def test_after_a_fresh_write_the_next_edit_snapshots_the_new_output(client, edited):
    client.put(
        "/courses/Algo/lectures/L1/summary?fresh=true", content="new ai".encode()
    )
    client.put("/courses/Algo/lectures/L1/summary", content="edit".encode())
    client.delete("/courses/Algo/lectures/L1/summary")

    # Restore brings back this run's output, never the summary it replaced.
    assert _summary(client) == {"content": "new ai", "hasOriginal": False}


def test_a_fresh_write_with_no_snapshot_just_writes(client, data_root):
    (data_root / "Algo" / "L1").mkdir(parents=True)

    r = client.put(
        "/courses/Algo/lectures/L1/summary?fresh=true", content="ai".encode()
    )

    assert r.status_code == 204
    assert _summary(client) == {"content": "ai", "hasOriginal": False}
