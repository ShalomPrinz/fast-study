"""HTTP-level checks that the overview endpoints accept a dot-prefixed marker name."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(data_root):
    """TestClient over the app, with a course dir already present."""

    import main

    (data_root / "Algo").mkdir()
    return TestClient(main.app)


def test_put_and_list_marker_via_http(client, data_root):
    client.put("/courses/Algo/overview/files/exam-hints.pdf", content=b"%PDF-")
    r = client.put(
        "/courses/Algo/overview/files/.exam-hints.pdf_warning", content=b"boom\n"
    )
    assert r.status_code == 204

    files = client.get("/courses/Algo/overview/files").json()["files"]
    assert [f["name"] for f in files] == ["exam-hints.pdf"]
    assert files[0]["warning"] == "boom"
