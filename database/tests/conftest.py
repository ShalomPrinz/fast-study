import sys
from pathlib import Path

import pytest

_DATABASE = Path(__file__).parent.parent
sys.path.insert(0, str(_DATABASE))


@pytest.fixture(autouse=True)
def data_root(tmp_path, monkeypatch):
    """Point the data root at a per-test temp dir so fs helpers never touch the real data directory."""

    # main seeds the root from the environment at import, so import it first or that seed wins.
    import main  # noqa: F401

    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr("fs.paths._data_root", root)
    return root
