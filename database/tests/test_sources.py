"""Skip set (POST /courses/{c}/skipped) and video source (?source= on PUT /…/video) as sidecars the tree reports."""

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


def _course(client, name="Algo"):
    """Return one course node from GET /tree."""

    (c,) = [c for c in client.get("/tree").json() if c["name"] == name]
    return c


def test_skipped_defaults_to_empty_list(client, data_root):
    (data_root / "Algo").mkdir()
    assert _course(client)["skipped"] == []


def test_add_remove_batch_idempotent_and_notifies_only_on_change(
    client, data_root, notifies
):
    (data_root / "Algo").mkdir()
    url = "/courses/Algo/skipped"

    r = client.post(url, json={"add": ["a", "b", "a"]})
    assert r.status_code == 200 and r.json() == {"refs": ["a", "b"]}
    assert _course(client)["skipped"] == ["a", "b"]
    assert len(notifies) == 1

    assert client.post(url, json={"add": ["b"]}).json() == {"refs": ["a", "b"]}
    assert client.post(url, json={"remove": ["zzz"]}).json() == {"refs": ["a", "b"]}
    assert len(notifies) == 1

    assert client.post(url, json={"add": ["c"], "remove": ["a"]}).json() == {
        "refs": ["b", "c"]
    }
    assert client.post(url, json={"remove": ["b", "c"]}).json() == {"refs": []}
    assert not (data_root / "Algo" / ".skipped.json").exists()
    assert len(notifies) == 3


def test_skipped_covers_recitation_refs_and_survives_course_rename(client, data_root):
    (data_root / "Algo").mkdir()
    client.post("/courses/Algo/skipped", json={"add": ["r1"]})
    assert client.patch("/courses/Algo", json={"name": "Algo2"}).status_code == 200
    assert _course(client, "Algo2")["skipped"] == ["r1"]


def test_skipped_missing_course_is_404(client, data_root):
    r = client.post("/courses/Nope/skipped", json={"add": ["a"]})
    assert r.status_code == 404 and r.json()["code"] == "course_not_found"
    assert not (data_root / "Nope").exists()


@pytest.mark.parametrize("body", [{"add": "a"}, {"add": [1]}, {"remove": [""]}, ["a"]])
def test_skipped_bad_body_is_400_and_touches_nothing(client, data_root, body):
    (data_root / "Algo").mkdir()
    r = client.post("/courses/Algo/skipped", json=body)
    assert r.status_code == 400 and r.json()["code"] == "bad_request_body"
    assert not (data_root / "Algo" / ".skipped.json").exists()


@pytest.mark.parametrize(
    "raw", ["{not json", '{"refs": "a"}', '["a"]', '{"refs": [1, "x", "x"]}']
)
def test_corrupt_skipped_reads_as_absent_and_heals(client, data_root, raw):
    (data_root / "Algo").mkdir()
    (data_root / "Algo" / ".skipped.json").write_text(raw)
    expect = ["x"] if raw.startswith('{"refs": [1') else []
    assert _course(client)["skipped"] == expect
    assert client.post("/courses/Algo/skipped", json={"add": ["y"]}).json()[
        "refs"
    ] == expect + ["y"]


@pytest.mark.parametrize("kind", ["lecture", "recitation"])
def test_video_source_recorded_replaced_kept_and_cleared(client, data_root, kind):
    (data_root / "Algo").mkdir()
    base = data_root / "Algo" / ("Recitations" if kind == "recitation" else "")
    url = f"/courses/Algo/lectures/L1/video?kind={kind}"

    def entry():
        c = _course(client)
        (e,) = [e for e in c["recitations" if kind == "recitation" else "lectures"]]
        return e

    assert client.put(url, content=b"v1").status_code == 204
    assert "videoSource" not in entry()

    assert client.put(url + "&source=ref-1", content=b"v2").status_code == 204
    assert entry()["videoSource"] == "ref-1"
    assert client.put(url + "&source=ref-2", content=b"v3").status_code == 204
    assert entry()["videoSource"] == "ref-2"

    # A removed video keeps its source.
    (base / "L1" / "video.mp4").unlink()
    assert entry()["videoSource"] == "ref-2"
    assert entry()["files"]["video.mp4"]["exists"] is False

    # Survives a rename of the lecture.
    client.put(url + "&source=ref-3", content=b"v4")
    client.patch(f"/courses/Algo/lectures/L1?kind={kind}", json={"name": "L2"})
    assert entry()["videoSource"] == "ref-3"

    # A sourceless fresh upload clears the stale ref.
    client.put(url.replace("L1", "L2"), content=b"v5")
    assert "videoSource" not in entry()


def test_corrupt_video_source_reads_as_absent(client, data_root):
    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    (d / ".video_source.json").write_text("{oops")
    (c,) = _course(client)["lectures"]
    assert "videoSource" not in c


def test_failed_sidecar_write_leaves_no_stale_ref(client, data_root, monkeypatch):
    """A swallowed new-sidecar write must not leave the previous video's ref in the tree."""

    import fs.sources

    (data_root / "Algo").mkdir()
    url = "/courses/Algo/lectures/L1/video"
    client.put(url + "?source=old", content=b"v1")
    assert _course(client)["lectures"][0]["videoSource"] == "old"

    monkeypatch.setattr(fs.sources, "write_json_dict", lambda *a, **k: None)
    assert client.put(url + "?source=new", content=b"v2").status_code == 204
    assert "videoSource" not in _course(client)["lectures"][0]
