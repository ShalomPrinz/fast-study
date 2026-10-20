"""The remove route, and the tree's `removed` field derived from the files on disk."""

import pytest
from fastapi.testclient import TestClient

URL = "/courses/Algo/lectures/L1/removed"


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
def lecture(data_root):
    """A finished lecture: every intermediate, the outputs and a material."""

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    for name in (
        "video.mp4",
        "audio.mp3",
        "transcript.txt",
        "summary.md",
        "summary.pdf",
        "drive_url.txt",
        "material.pdf",
    ):
        (d / name).write_bytes(b"x")
    return d


def _tree_lecture(client, kind="lectures"):
    """Return the first lecture (or recitation) entry of the Algo course from GET /tree."""

    course = next(c for c in client.get("/tree").json() if c["name"] == "Algo")
    return course[kind][0]


def test_removes_files_and_notifies_once(client, lecture, notifies):
    r = client.post(URL, json={"files": ["audio.mp3", "video.mp4"]})

    assert r.status_code == 204
    assert sorted(p.name for p in lecture.iterdir()) == [
        "drive_url.txt",
        "material.pdf",
        "summary.md",
        "summary.pdf",
        "transcript.txt",
    ]
    assert _tree_lecture(client)["removed"] == ["video.mp4", "audio.mp3"]
    assert notifies == [1]


def test_repeating_a_removal_is_idempotent(client, lecture):
    client.post(URL, json={"files": ["video.mp4"]})
    r = client.post(URL, json={"files": ["video.mp4"]})

    assert r.status_code == 204
    assert _tree_lecture(client)["removed"] == ["video.mp4"]


@pytest.mark.parametrize(
    "name",
    ["transcript.txt", "summary.md", "summary.pdf", "drive_url.txt", "material.pdf"],
)
def test_a_non_removable_name_is_refused_and_nothing_is_touched(
    client, lecture, notifies, name
):
    r = client.post(URL, json={"files": ["video.mp4", name]})

    assert r.status_code == 400
    assert r.json()["code"] == "file_not_removable"
    assert r.json()["params"] == {"file": name}
    assert (lecture / "video.mp4").exists()
    assert notifies == []


@pytest.mark.parametrize(
    "body", [{}, [], "video.mp4", {"files": "video.mp4"}, {"files": [1]}]
)
def test_a_malformed_body_is_refused(client, lecture, body):
    r = client.post(URL, json=body)

    assert r.status_code == 400
    assert r.json()["code"] == "bad_request_body"


def test_a_missing_lecture_is_404_and_creates_nothing(client, data_root):
    (data_root / "Algo").mkdir()

    r = client.post(URL, json={"files": ["video.mp4"]})

    assert r.status_code == 404
    assert r.json()["code"] == "lecture_not_found"
    assert list((data_root / "Algo").iterdir()) == []


def test_recitations_are_addressed_by_kind(client, data_root):
    d = data_root / "Algo" / "Recitations" / "R1"
    d.mkdir(parents=True)
    (d / "video.mp4").write_bytes(b"x")
    (d / "audio.mp3").write_bytes(b"x")

    r = client.post(
        "/courses/Algo/lectures/R1/removed?kind=recitation",
        json={"files": ["video.mp4"]},
    )

    assert r.status_code == 204
    assert _tree_lecture(client, "recitations")["removed"] == ["video.mp4"]


def test_one_locked_file_refuses_the_whole_set(client, lecture, monkeypatch):
    from fs import paths

    real_open = paths.Path.open

    def locked_audio(self, *args, **kwargs):
        """Raise a Windows sharing violation for audio.mp3 only."""

        if self.name == "audio.mp3":
            e = PermissionError(13, "in use")
            e.winerror = 32
            raise e
        return real_open(self, *args, **kwargs)

    monkeypatch.setattr(paths.Path, "open", locked_audio)

    r = client.post(URL, json={"files": ["video.mp4", "audio.mp3"]})

    assert r.status_code == 423
    assert r.json()["code"] == "file_locked"
    assert r.json()["params"] == {"file": "audio.mp3"}
    assert (lecture / "video.mp4").exists()


def test_a_failed_unlink_names_its_file(client, lecture, monkeypatch):
    from pathlib import Path

    real_unlink = Path.unlink

    def broken_audio(self, *args, **kwargs):
        """Fail the audio.mp3 unlink with a plain OS error."""

        if self.name == "audio.mp3":
            raise OSError(5, "I/O error")
        return real_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", broken_audio)

    r = client.post(URL, json={"files": ["audio.mp3"]})

    assert r.status_code == 400
    assert r.json()["code"] == "file_delete_failed"
    assert r.json()["params"]["file"] == "audio.mp3"
    # Still on disk, so the tree does not call it removed.
    assert _tree_lecture(client)["removed"] == []


def _lecture_with(data_root, *names):
    """Create Algo/L1 holding exactly the given files."""

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    for name in names:
        (d / name).write_bytes(b"x")
    return d


@pytest.mark.parametrize(
    "names, removed",
    [
        (("video.mp4", "audio.mp3", "transcript.txt"), []),
        (("audio.mp3",), ["video.mp4"]),
        (("transcript.txt",), ["video.mp4", "audio.mp3"]),
        (("audio.mp3", "transcript.txt"), ["video.mp4"]),
        (("video.mp4", "transcript.txt"), ["audio.mp3"]),
        (("video.mp4",), []),
        (("summary.md", "summary.pdf", "drive_url.txt"), []),
        ((), []),
    ],
)
def test_removed_is_derived_from_the_files_on_disk(client, data_root, names, removed):
    _lecture_with(data_root, *names)

    assert _tree_lecture(client)["removed"] == removed


def test_a_materials_only_lecture_reports_nothing_removed(client, data_root):
    _lecture_with(data_root, "material.pdf", "material.2.pdf")

    assert _tree_lecture(client)["removed"] == []


def test_a_manual_delete_reads_as_removed(client, lecture):
    # No route call: who deleted the file does not matter, only what the disk proves.
    (lecture / "video.mp4").unlink()
    (lecture / "audio.mp3").unlink()

    assert _tree_lecture(client)["removed"] == ["video.mp4", "audio.mp3"]


def test_a_file_written_back_is_no_longer_removed(client, lecture):
    client.post(URL, json={"files": ["video.mp4", "audio.mp3"]})

    r = client.put("/courses/Algo/lectures/L1/files/audio.mp3", content=b"new")

    assert r.status_code == 204
    assert _tree_lecture(client)["removed"] == ["video.mp4"]
