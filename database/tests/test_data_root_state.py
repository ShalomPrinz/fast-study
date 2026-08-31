"""The unconfigured data root: it is a real state, and every filesystem endpoint answers 409 in it."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fs.paths import DataRootNotConfigured, data_root

_DATABASE = Path(__file__).parent.parent


@pytest.fixture
def client():
    """TestClient over the app."""

    import main

    return TestClient(main.app)


@pytest.fixture
def unconfigured(monkeypatch):
    """Drop the root the autouse fixture set, putting the service in its fresh-install state."""

    monkeypatch.setattr("fs.paths._data_root", None)


def test_data_root_raises_when_unset(unconfigured):
    with pytest.raises(DataRootNotConfigured):
        data_root()


def test_tree_answers_409(client, unconfigured):
    # /tree has no blanket handler of its own, and is the first call the app makes.
    r = client.get("/tree")

    assert r.status_code == 409
    assert "not configured" in r.json()["error"]


def test_a_blanket_handler_endpoint_answers_409_not_400(client, unconfigured):
    r = client.get("/courses/Algo/lectures/L1/materials")

    assert r.status_code == 409
    assert "error" in r.json()


def test_config_clears_the_condition(client, unconfigured, tmp_path):
    assert client.get("/tree").status_code == 409

    assert (
        client.post("/config", json={"data_root": str(tmp_path / "fresh")}).status_code
        == 204
    )

    assert client.get("/tree").status_code == 200


def test_importing_main_without_data_root_does_not_raise(tmp_path):
    # cwd is outside the repo so load_dotenv() finds no .env either.
    env = {k: v for k, v in os.environ.items() if k != "DATA_ROOT"}
    env["PYTHONPATH"] = str(_DATABASE)

    r = subprocess.run(
        [
            sys.executable,
            "-c",
            "import main, fs.paths; assert fs.paths._data_root is None",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
    )

    assert r.returncode == 0, r.stderr
