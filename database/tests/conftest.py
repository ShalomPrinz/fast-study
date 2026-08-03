import os
import sys
from pathlib import Path

import pytest

_DATABASE = Path(__file__).parent.parent
sys.path.insert(0, str(_DATABASE))


@pytest.fixture(autouse=True)
def data_root(tmp_path, monkeypatch):
    """Point DATA_ROOT at a per-test temp dir so fs helpers never touch the real data directory."""

    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setitem(os.environ, "DATA_ROOT", str(root))
    return root
