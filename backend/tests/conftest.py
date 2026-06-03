import sys
from pathlib import Path

_BACKEND = Path(__file__).parent.parent
sys.path.insert(0, str(_BACKEND / "pipeline"))
sys.path.insert(0, str(_BACKEND))

import pytest

import timing


# The @timed_pipeline decorator writes to timing.db which exists in DB_PATH
# To achieve test isolation, we use a temporary file for the database during tests
@pytest.fixture(autouse=True)
def isolate_timing_db(tmp_path, monkeypatch):
    monkeypatch.setattr(timing, "DB_PATH", tmp_path / "timing.db")
    timing.init_db()
