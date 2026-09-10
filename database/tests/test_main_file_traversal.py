"""HTTP-level checks that a lecture file name cannot escape its lecture dir."""

import pytest
from fastapi.testclient import TestClient
from fs.files import file_path


@pytest.fixture
def client(data_root):
    """TestClient over the app."""

    import database_main

    return TestClient(database_main.app)


@pytest.fixture
def lecture(data_root):
    """A lecture dir holding one legitimate file."""

    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    (d / "summary.pdf").write_bytes(b"%PDF-")
    return d


# A backslash escape carries no "/", so it survives URL normalisation and reaches {name} intact.
ESCAPES = ("..\\..\\..\\Windows\\x.exe", "C:\\Windows\\win.ini", "..", "sub/deep.pdf")


class TestFilePathResolver:
    @pytest.mark.parametrize("name", ESCAPES)
    def test_rejects_an_escaping_name(self, name):
        with pytest.raises(ValueError):
            file_path("Algo", "L1", name, "lecture")

    def test_accepts_an_ordinary_name(self, data_root):
        assert file_path("Algo", "L1", "summary.pdf", "lecture") == (
            data_root / "Algo" / "L1" / "summary.pdf"
        )


class TestRoutes:
    @pytest.mark.parametrize("name", ESCAPES)
    def test_path_route_refuses_with_4xx(self, client, lecture, name):
        r = client.get(f"/courses/Algo/lectures/L1/files/{name}/path")
        assert 400 <= r.status_code < 500
        assert "path" not in r.json()

    @pytest.mark.parametrize("name", ESCAPES)
    def test_get_route_refuses_with_4xx(self, client, lecture, name):
        assert (
            400
            <= client.get(f"/courses/Algo/lectures/L1/files/{name}").status_code
            < 500
        )

    @pytest.mark.parametrize("name", ESCAPES)
    def test_head_route_refuses_with_4xx(self, client, lecture, name):
        assert (
            400
            <= client.head(f"/courses/Algo/lectures/L1/files/{name}").status_code
            < 500
        )
