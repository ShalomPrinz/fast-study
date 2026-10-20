"""The remove route: deletes intermediates, records them, and the record's lifecycle in the tree."""

import json

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


def test_removes_files_records_them_and_notifies_once(client, lecture, notifies):
    r = client.post(URL, json={"files": ["audio.mp3", "video.mp4"]})

    assert r.status_code == 204
    assert sorted(p.name for p in lecture.iterdir()) == [
        ".removed.json",
        "drive_url.txt",
        "material.pdf",
        "summary.md",
        "summary.pdf",
        "transcript.txt",
    ]
    assert _tree_lecture(client)["removed"] == ["video.mp4", "audio.mp3"]
    assert notifies == [1]


def test_tree_reports_an_empty_list_when_nothing_was_removed(client, lecture):
    assert _tree_lecture(client)["removed"] == []


def test_a_later_call_merges_with_the_earlier_record(client, lecture):
    client.post(URL, json={"files": ["video.mp4"]})
    client.post(URL, json={"files": ["audio.mp3"]})

    assert _tree_lecture(client)["removed"] == ["video.mp4", "audio.mp3"]


def test_repeating_a_removal_is_idempotent(client, lecture):
    client.post(URL, json={"files": ["video.mp4"]})
    r = client.post(URL, json={"files": ["video.mp4"]})

    assert r.status_code == 204
    assert _tree_lecture(client)["removed"] == ["video.mp4"]


def test_an_absent_file_is_not_recorded(client, lecture):
    # A video the user deleted by hand was never auto-removed, so it must not read as such.
    (lecture / "video.mp4").unlink()

    assert client.post(URL, json={"files": ["video.mp4"]}).status_code == 204
    assert _tree_lecture(client)["removed"] == []


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
    assert not (lecture / ".removed.json").exists()
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
    assert not (lecture / ".removed.json").exists()


def test_writing_a_removed_file_back_drops_it_from_the_record(client, lecture):
    client.post(URL, json={"files": ["video.mp4", "audio.mp3"]})

    r = client.put("/courses/Algo/lectures/L1/files/audio.mp3", content=b"new")

    assert r.status_code == 204
    assert _tree_lecture(client)["removed"] == ["video.mp4"]
    assert json.loads((lecture / ".removed.json").read_text()) == ["video.mp4"]


def test_a_new_video_clears_the_record(client, lecture):
    client.post(URL, json={"files": ["video.mp4", "audio.mp3"]})

    r = client.put("/courses/Algo/lectures/L1/video", content=b"\x00mp4")

    assert r.status_code == 204
    assert not (lecture / ".removed.json").exists()
    assert _tree_lecture(client)["removed"] == []


def test_a_recorded_file_back_on_disk_is_not_reported_removed(client, lecture):
    # The record is written before the unlinks, so a failed unlink can leave a recorded file in place.
    (lecture / ".removed.json").write_text('["video.mp4"]')

    assert _tree_lecture(client)["removed"] == []


def test_a_corrupt_record_reads_as_empty(client, lecture):
    (lecture / "video.mp4").unlink()
    (lecture / ".removed.json").write_text("{not json")

    assert _tree_lecture(client)["removed"] == []


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
    # Recorded but still on disk, so the tree does not call it removed.
    assert _tree_lecture(client)["removed"] == []
