"""Create and rename refuse a name that already exists with 409 name_taken, never merging or replacing."""

import pytest
from fastapi.testclient import TestClient
from fs.paths import SOURCE_URL_MARKER


@pytest.fixture
def client():
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


def _assert_taken(r, name):
    assert r.status_code == 409
    assert r.json()["code"] == "name_taken"
    assert r.json()["params"] == {"name": name}


def test_create_course_refuses_existing_and_keeps_its_source_url(client, data_root):
    (data_root / "Algo").mkdir()
    (data_root / "Algo" / SOURCE_URL_MARKER).write_text("https://old")

    r = client.post("/courses", json={"name": "Algo", "source_url": "https://new"})

    _assert_taken(r, "Algo")
    assert (data_root / "Algo" / SOURCE_URL_MARKER).read_text() == "https://old"


def test_create_course_new_name_still_works(client, data_root):
    r = client.post("/courses", json={"name": "Algo", "source_url": "https://x"})
    assert r.status_code == 204
    assert (data_root / "Algo" / SOURCE_URL_MARKER).read_text() == "https://x"


@pytest.mark.parametrize(
    "kind,parent", [("lecture", ""), ("recitation", "Recitations")]
)
def test_create_lecture_refuses_existing(client, data_root, kind, parent):
    (data_root / "Algo" / parent / "L1").mkdir(parents=True)

    r = client.post(f"/courses/Algo/lectures?kind={kind}", json={"name": "L1"})

    _assert_taken(r, "L1")


def test_create_recitation_with_existing_recitations_dir_works(client, data_root):
    (data_root / "Algo" / "Recitations" / "R1").mkdir(parents=True)

    r = client.post("/courses/Algo/lectures?kind=recitation", json={"name": "R2"})

    assert r.status_code == 204
    assert (data_root / "Algo" / "Recitations" / "R2").is_dir()


def test_rename_course_refuses_existing_empty_target(client, data_root):
    (data_root / "Algo" / "L1").mkdir(parents=True)
    (data_root / "Calc").mkdir()

    r = client.patch("/courses/Algo", json={"name": "Calc"})

    _assert_taken(r, "Calc")
    assert (data_root / "Algo" / "L1").is_dir()


def test_rename_lecture_refuses_existing_empty_target(client, data_root):
    (data_root / "Algo" / "L1").mkdir(parents=True)
    (data_root / "Algo" / "L1" / "video.mp4").write_bytes(b"v")
    (data_root / "Algo" / "L2").mkdir()

    r = client.patch("/courses/Algo/lectures/L1", json={"name": "L2"})

    _assert_taken(r, "L2")
    assert (data_root / "Algo" / "L1" / "video.mp4").exists()


def test_rename_course_case_only_works(client, data_root):
    (data_root / "algo").mkdir()

    r = client.patch("/courses/algo", json={"name": "Algo"})

    assert r.status_code == 204
    assert [p.name for p in data_root.iterdir()] == ["Algo"]


def test_rename_to_the_same_dir_is_not_refused(client, data_root):
    # The target resolving to the source itself is how a case-only rename looks on case-insensitive NTFS.
    (data_root / "Algo" / "L1").mkdir(parents=True)

    r = client.patch("/courses/Algo/lectures/L1", json={"name": "L1"})

    assert r.status_code == 204
    assert (data_root / "Algo" / "L1").is_dir()


def _deny_rename(monkeypatch, platform, winerror):
    """Make every Path.rename fail the way the given platform reports an access denial."""

    def rename(self, target):
        e = PermissionError(13, "Access is denied", str(self), None, str(target))
        e.winerror = winerror
        raise e

    monkeypatch.setattr("sys.platform", platform)
    monkeypatch.setattr("pathlib.Path.rename", rename)


@pytest.mark.parametrize(
    "path,old", [("/courses/Algo", "Algo"), ("/courses/Algo/lectures/L1", "L1")]
)
def test_windows_access_denied_rename_is_folder_in_use(
    client, data_root, monkeypatch, path, old
):
    # Real Windows answers WinError 5 when any file under the dir is open, even a fully shared one.
    (data_root / "Algo" / "L1").mkdir(parents=True)
    _deny_rename(monkeypatch, "win32", 5)

    r = client.patch(path, json={"name": "New"})

    assert r.status_code == 423
    assert r.json()["code"] == "folder_in_use"
    assert r.json()["params"] == {"name": old}


def test_posix_permission_error_on_rename_is_not_relabelled(
    client, data_root, monkeypatch
):
    (data_root / "Algo").mkdir()
    _deny_rename(monkeypatch, "linux", None)

    r = client.patch("/courses/Algo", json={"name": "New"})

    assert r.status_code == 400
    assert r.json()["code"] == "rename_failed"
