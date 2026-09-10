"""HTTP-level checks that a Windows sharing violation answers 423, and a POSIX one still 400."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(data_root):
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def lecture(data_root):
    """A lecture dir holding a summary.pdf to write over or delete."""

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    (d / "summary.pdf").write_bytes(b"%PDF-old")
    return d


def _sharing_violation(*_args, **_kwargs):
    """Raise the PermissionError Windows raises when another program holds the file open."""

    # BaseException instances take attribute assignment, so the winerror the code branches on can
    # be simulated from Linux, where a real PermissionError never carries one.
    e = PermissionError(
        13, "The process cannot access the file because it is being used"
    )
    e.winerror = 32
    raise e


def _plain_permission_error(*_args, **_kwargs):
    """Raise the bare PermissionError POSIX raises for a genuine permissions problem."""

    raise PermissionError(13, "Permission denied")


class TestWriteFile:
    def test_sharing_violation_is_423(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.write_bytes", _sharing_violation)

        r = client.put(
            "/courses/Algo/lectures/L1/files/summary.pdf", content=b"%PDF-new"
        )
        assert r.status_code == 423
        assert r.json() == {
            "error": "summary.pdf is open in another program. Close it and try again."
        }

    def test_plain_permission_error_stays_400(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.write_bytes", _plain_permission_error)

        r = client.put(
            "/courses/Algo/lectures/L1/files/summary.pdf", content=b"%PDF-new"
        )
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]


class TestDeleteFile:
    def test_sharing_violation_is_423(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.unlink", _sharing_violation)

        r = client.delete("/courses/Algo/lectures/L1/files/summary.pdf")
        assert r.status_code == 423
        assert r.json() == {
            "error": "summary.pdf is open in another program. Close it and try again."
        }

    def test_plain_permission_error_stays_400(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.unlink", _plain_permission_error)

        r = client.delete("/courses/Algo/lectures/L1/files/summary.pdf")
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]


def _locked_file(name: str):
    """A Path.open replacement that reports {name} as held open and passes everything else through."""

    real_open = Path.open

    def fake_open(self, *args, **kwargs):
        if self.name == name:
            _sharing_violation()
        return real_open(self, *args, **kwargs)

    return fake_open


class TestWriteOverviewFile:
    def test_sharing_violation_is_423(self, client, data_root, monkeypatch):
        (data_root / "Algo").mkdir()
        monkeypatch.setattr("pathlib.Path.write_bytes", _sharing_violation)

        r = client.put("/courses/Algo/overview/files/exam.pdf", content=b"%PDF-new")
        assert r.status_code == 423
        assert r.json() == {
            "error": "exam.pdf is open in another program. Close it and try again."
        }

    def test_plain_permission_error_stays_400(self, client, data_root, monkeypatch):
        (data_root / "Algo").mkdir()
        monkeypatch.setattr("pathlib.Path.write_bytes", _plain_permission_error)

        r = client.put("/courses/Algo/overview/files/exam.pdf", content=b"%PDF-new")
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]


class TestWriteVideo:
    def test_a_locked_artifact_wipes_nothing(self, client, lecture, monkeypatch):
        (lecture / "video.mp4").write_bytes(b"old")
        (lecture / "audio.mp3").write_bytes(b"mp3")
        (lecture / "material.pdf").write_bytes(b"%PDF-")
        monkeypatch.setattr("pathlib.Path.open", _locked_file("summary.pdf"))

        r = client.put("/courses/Algo/lectures/L1/video", content=b"new")
        assert r.status_code == 423
        assert r.json() == {
            "error": "summary.pdf is open in another program. Close it and try again."
        }
        # The whole wipe set survives, so a re-upload after closing the viewer starts clean.
        assert (lecture / "video.mp4").read_bytes() == b"old"
        assert (lecture / "audio.mp3").exists()
        assert (lecture / "material.pdf").exists()
        assert (lecture / "summary.pdf").exists()

    def test_a_lock_taken_after_the_probe_is_still_423(
        self, client, lecture, monkeypatch
    ):
        monkeypatch.setattr("pathlib.Path.unlink", _sharing_violation)

        r = client.put("/courses/Algo/lectures/L1/video", content=b"new")
        assert r.status_code == 423
        assert "summary.pdf" in r.json()["error"]

    def test_plain_permission_error_stays_400(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.unlink", _plain_permission_error)

        r = client.put("/courses/Algo/lectures/L1/video", content=b"new")
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]
