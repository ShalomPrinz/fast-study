from unittest.mock import patch

import pytest
import upload_to_drive as drive_mod
from upload_to_drive import upload_to_drive


class FakeFiles:
    """In-memory stand-in for the Drive files() resource. Tracks folders and
    files by (name, parent) so we can assert create-vs-update behaviour."""

    def __init__(self, store):
        self.store = store

    def list(self, q, fields, pageSize):
        self.store["pending_list"] = q
        return self

    def create(self, body=None, media_body=None, fields=None):
        name = body["name"]
        parents = body.get("parents", ["root"])
        parent = parents[0]
        is_folder = body.get("mimeType") == "application/vnd.google-apps.folder"
        new_id = f"id-{len(self.store['files'])}"
        self.store["files"].append(
            {"id": new_id, "name": name, "parent": parent, "folder": is_folder}
        )
        self.store["create_calls"].append(name)
        return _Exec({"id": new_id, "webViewLink": f"https://drive/{new_id}"})

    def update(self, fileId, media_body=None, fields=None):
        self.store["update_calls"].append(fileId)
        return _Exec({"id": fileId, "webViewLink": f"https://drive/{fileId}"})

    def execute(self):
        # Resolve the most recent list() query against the in-memory store,
        # honouring name, folder-vs-file, and the "'<parent>' in parents" scope.
        q = self.store.pop("pending_list")
        is_folder_query = "mimeType='application/vnd.google-apps.folder'" in q
        name = q.split("name='", 1)[1].split("'", 1)[0]
        parent = q.split(" in parents", 1)[0].rsplit("'", 2)[1]
        matches = [
            f
            for f in self.store["files"]
            if f["name"] == name
            and f["folder"] == is_folder_query
            and f["parent"] == parent
        ]
        return {"files": [{"id": matches[0]["id"]}] if matches else []}


class _Exec:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return self._result


class FakeService:
    def __init__(self, store):
        self._files = FakeFiles(store)

    def files(self):
        return self._files


@pytest.fixture
def store():
    return {"files": [], "create_calls": [], "update_calls": []}


@pytest.fixture(autouse=True)
def _env():
    with patch.dict("os.environ", {"GDRIVE_ROOT_FOLDER": "Root"}):
        yield


def _pdf(tmp_path):
    p = tmp_path / "summary.pdf"
    p.write_bytes(b"%PDF-1.4\n")
    return str(p)


def test_first_upload_creates_file(tmp_path, store):
    with patch.object(drive_mod, "_get_service", return_value=FakeService(store)):
        url = upload_to_drive(_pdf(tmp_path), "Course", file_name="summary.pdf")

    assert "summary.pdf" in store["create_calls"]  # the file itself was created
    assert store["update_calls"] == []
    assert url.startswith("https://drive/")


def test_reupload_same_name_updates_in_place(tmp_path, store):
    # First upload creates the PDF; a second run with the same name must update
    # that file's contents rather than create a duplicate.
    with patch.object(drive_mod, "_get_service", return_value=FakeService(store)):
        upload_to_drive(_pdf(tmp_path), "Course", file_name="summary.pdf")
        first_create_count = store["create_calls"].count("summary.pdf")
        upload_to_drive(_pdf(tmp_path), "Course", file_name="summary.pdf")

    assert first_create_count == 1
    assert store["create_calls"].count("summary.pdf") == 1  # no second create
    assert len(store["update_calls"]) == 1
    # Only one PDF named summary.pdf ever exists on disk.
    pdfs = [f for f in store["files"] if f["name"] == "summary.pdf"]
    assert len(pdfs) == 1


def test_subfolder_file_lookup_is_scoped_to_subfolder(tmp_path, store):
    # A same-named file in the course root must NOT be mistaken for the one in
    # the Recitations subfolder — re-upload there should update the subfolder copy.
    with patch.object(drive_mod, "_get_service", return_value=FakeService(store)):
        upload_to_drive(_pdf(tmp_path), "Course", file_name="t.pdf")
        upload_to_drive(
            _pdf(tmp_path), "Course", file_name="t.pdf", subfolder="Recitations"
        )
        upload_to_drive(
            _pdf(tmp_path), "Course", file_name="t.pdf", subfolder="Recitations"
        )

    pdfs = [f for f in store["files"] if f["name"] == "t.pdf"]
    assert len(pdfs) == 2  # one in course root, one in Recitations
    assert len(store["update_calls"]) == 1  # only the second Recitations upload updated
