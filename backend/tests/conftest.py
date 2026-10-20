import sys
from pathlib import Path

_BACKEND = Path(__file__).parent.parent
sys.path.insert(0, str(_BACKEND / "pipeline"))
sys.path.insert(0, str(_BACKEND))

import pytest
import timing


# @timed_pipeline writes to the real timing.db — point it at a temp file for isolation.
@pytest.fixture(autouse=True)
def isolate_timing_db(tmp_path, monkeypatch):
    monkeypatch.setattr(timing, "DB_PATH", tmp_path / "timing.db")
    timing.init_db()


# The hook at the end of every locked run reads AUTO_REMOVE live; a developer's own .env value
# would otherwise make every runner test issue removal calls.
@pytest.fixture(autouse=True)
def no_auto_remove(monkeypatch):
    monkeypatch.delenv("AUTO_REMOVE", raising=False)
    monkeypatch.delenv("AUTO_REMOVE_AFTER", raising=False)
