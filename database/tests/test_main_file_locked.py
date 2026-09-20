"""HTTP-level checks that a Windows sharing violation answers 423, and a POSIX one still 400."""

import errno
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _locked_body(file: str) -> dict:
    """The exact 423 envelope for a file held open elsewhere: prose, code, and the file it names."""

    return {
        "error": f"{file} is open in another program. Close it and try again.",
        "code": "file_locked",
        "params": {"file": file},
    }


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


def _crt_denial(self, *_args, **_kwargs):
    """Raise the winerror-less EACCES the CRT gives open()/write_bytes() on a locked Windows file."""

    # The CRT path is what the real bug was: no winerror at all, so only the filename tells the
    # classifier whether this is a lock or a genuine denial.
    raise PermissionError(errno.EACCES, "Permission denied", str(self))


@pytest.fixture
def on_windows(monkeypatch):
    """Make the platform check in fs.paths see win32 so CRT-shaped denials can be tested from Linux."""

    monkeypatch.setattr(sys, "platform", "win32")


class TestWriteFile:
    def test_sharing_violation_is_423(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.write_bytes", _sharing_violation)

        r = client.put(
            "/courses/Algo/lectures/L1/files/summary.pdf", content=b"%PDF-new"
        )
        assert r.status_code == 423
        assert r.json() == _locked_body("summary.pdf")

    def test_plain_permission_error_stays_400(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.write_bytes", _plain_permission_error)

        r = client.put(
            "/courses/Algo/lectures/L1/files/summary.pdf", content=b"%PDF-new"
        )
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]
        assert r.json()["code"] == "file_write_failed"
        assert r.json()["params"]["file"] == "summary.pdf"
        assert "Permission denied" in r.json()["params"]["detail"]


class TestWriteFileCrtDenial:
    """EACCES with no winerror — what a locked file actually raises through write_bytes()."""

    def test_writable_file_on_win32_is_423(
        self, client, lecture, on_windows, monkeypatch
    ):
        monkeypatch.setattr("pathlib.Path.write_bytes", _crt_denial)

        r = client.put(
            "/courses/Algo/lectures/L1/files/summary.pdf", content=b"%PDF-new"
        )
        assert r.status_code == 423
        assert r.json() == _locked_body("summary.pdf")

    def test_same_error_on_posix_stays_400(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.write_bytes", _crt_denial)

        r = client.put(
            "/courses/Algo/lectures/L1/files/summary.pdf", content=b"%PDF-new"
        )
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]
        assert r.json()["code"] == "file_write_failed"
        assert r.json()["params"]["file"] == "summary.pdf"
        assert "Permission denied" in r.json()["params"]["detail"]

    def test_read_only_file_on_win32_stays_400(
        self, client, lecture, on_windows, monkeypatch
    ):
        os.chmod(lecture / "summary.pdf", 0o444)
        monkeypatch.setattr("pathlib.Path.write_bytes", _crt_denial)

        r = client.put(
            "/courses/Algo/lectures/L1/files/summary.pdf", content=b"%PDF-new"
        )
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]
        assert r.json()["code"] == "file_write_failed"
        assert r.json()["params"]["file"] == "summary.pdf"
        assert "Permission denied" in r.json()["params"]["detail"]

    def test_missing_file_on_win32_stays_400(
        self, client, lecture, on_windows, monkeypatch
    ):
        monkeypatch.setattr("pathlib.Path.write_bytes", _crt_denial)

        r = client.put("/courses/Algo/lectures/L1/files/gone.pdf", content=b"%PDF-new")
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]
        assert r.json()["code"] == "file_write_failed"
        assert r.json()["params"]["file"] == "gone.pdf"
        assert "Permission denied" in r.json()["params"]["detail"]


class TestDeleteFile:
    def test_sharing_violation_is_423(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.unlink", _sharing_violation)

        r = client.delete("/courses/Algo/lectures/L1/files/summary.pdf")
        assert r.status_code == 423
        assert r.json() == _locked_body("summary.pdf")

    def test_plain_permission_error_stays_400(self, client, lecture, monkeypatch):
        monkeypatch.setattr("pathlib.Path.unlink", _plain_permission_error)

        r = client.delete("/courses/Algo/lectures/L1/files/summary.pdf")
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]
        assert r.json()["code"] == "file_delete_failed"
        assert r.json()["params"]["file"] == "summary.pdf"
        assert "Permission denied" in r.json()["params"]["detail"]


def _locked_file(name: str):
    """A Path.open replacement that reports {name} as held open and passes everything else through."""

    real_open = Path.open

    def fake_open(self, *args, **kwargs):
        if self.name == name:
            _sharing_violation()
        return real_open(self, *args, **kwargs)

    return fake_open


def _crt_locked_file(name: str):
    """Like _locked_file, but the probe's open() fails the way the CRT really reports a lock."""

    real_open = Path.open

    def fake_open(self, *args, **kwargs):
        if self.name == name:
            _crt_denial(self)
        return real_open(self, *args, **kwargs)

    return fake_open


class TestWriteOverviewFile:
    def test_sharing_violation_is_423(self, client, data_root, monkeypatch):
        (data_root / "Algo").mkdir()
        monkeypatch.setattr("pathlib.Path.write_bytes", _sharing_violation)

        r = client.put("/courses/Algo/overview/files/exam.pdf", content=b"%PDF-new")
        assert r.status_code == 423
        assert r.json() == _locked_body("exam.pdf")

    def test_plain_permission_error_stays_400(self, client, data_root, monkeypatch):
        (data_root / "Algo").mkdir()
        monkeypatch.setattr("pathlib.Path.write_bytes", _plain_permission_error)

        r = client.put("/courses/Algo/overview/files/exam.pdf", content=b"%PDF-new")
        assert r.status_code == 400
        assert "Permission denied" in r.json()["error"]
        assert r.json()["code"] == "file_write_failed"
        assert r.json()["params"]["file"] == "exam.pdf"
        assert "Permission denied" in r.json()["params"]["detail"]


class TestWriteVideo:
    def test_a_locked_artifact_wipes_nothing(self, client, lecture, monkeypatch):
        (lecture / "video.mp4").write_bytes(b"old")
        (lecture / "audio.mp3").write_bytes(b"mp3")
        (lecture / "material.pdf").write_bytes(b"%PDF-")
        monkeypatch.setattr("pathlib.Path.open", _locked_file("summary.pdf"))

        r = client.put("/courses/Algo/lectures/L1/video", content=b"new")
        assert r.status_code == 423
        assert r.json() == _locked_body("summary.pdf")
        # The whole wipe set survives, so a re-upload after closing the viewer starts clean.
        assert (lecture / "video.mp4").read_bytes() == b"old"
        assert (lecture / "audio.mp3").exists()
        assert (lecture / "material.pdf").exists()
        assert (lecture / "summary.pdf").exists()

    def test_a_crt_locked_artifact_wipes_nothing(
        self, client, lecture, on_windows, monkeypatch
    ):
        (lecture / "video.mp4").write_bytes(b"old")
        (lecture / "audio.mp3").write_bytes(b"mp3")
        (lecture / "material.pdf").write_bytes(b"%PDF-")
        monkeypatch.setattr("pathlib.Path.open", _crt_locked_file("summary.pdf"))

        r = client.put("/courses/Algo/lectures/L1/video", content=b"new")
        assert r.status_code == 423
        assert r.json() == _locked_body("summary.pdf")
        # The probe has to refuse before the unlink loop, so the whole wipe set is still on disk.
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
        assert r.json()["code"] == "file_write_failed"
        assert r.json()["params"]["file"] == "video.mp4"
        assert "Permission denied" in r.json()["params"]["detail"]
