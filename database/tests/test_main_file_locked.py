"""HTTP-level checks that a Windows sharing violation answers 423, and a POSIX one still 400."""

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
