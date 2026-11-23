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


# A summary run records its materials through the database; tests read the call off this mock.
@pytest.fixture(autouse=True)
def put_materials(monkeypatch):
    from unittest.mock import MagicMock

    from services import db_client

    mock = MagicMock()
    monkeypatch.setattr(db_client, "put_summary_materials", mock)
    return mock


# The pdf step lists the summary's figures through the database; none unless a test says otherwise.
@pytest.fixture(autouse=True)
def no_figures(monkeypatch):
    from unittest.mock import MagicMock

    from services import db_client

    mock = MagicMock(return_value=[])
    monkeypatch.setattr(db_client, "list_figures", mock)
    return mock


_NOTIFY_TOPICS = {"runner", "tree", "settings", "drive"}


class _Recorded:
    """A call that records itself and forwards attribute reads and writes (`.side_effect`,
    `.assert_called_once`) to the callable it wraps, so a patched mock stays usable through it."""

    def __init__(self, target, record):
        object.__setattr__(self, "_target", target)
        object.__setattr__(self, "_record", record)

    def __call__(self, *args, **kwargs):
        return self._record(self._target, args, kwargs)

    def __getattr__(self, name):
        return getattr(self._target, name)

    def __setattr__(self, name, value):
        setattr(self._target, name, value)


class _TrackedDb:
    """Stands in for `db_client` and records, in call order, the file writes and notify topics.
    Attributes resolve at call time, so a test's own patch of a write or of `notify` still runs."""

    _WRITE_PREFIXES = ("put_", "delete_", "patch_", "remove_")

    def __init__(self, real, ledger):
        object.__setattr__(self, "_real", real)
        object.__setattr__(self, "_ledger", ledger)

    def __getattribute__(self, name):
        if name.startswith("__") or name in ("_real", "_ledger"):
            return object.__getattribute__(self, name)
        own = object.__getattribute__(self, "__dict__")
        real = object.__getattribute__(self, "_real")
        ledger = object.__getattribute__(self, "_ledger")
        target = own[name] if name in own else getattr(real, name)
        if name == "notify":
            return _Recorded(target, lambda fn, a, kw: ledger.notified(a, fn))
        if name.startswith(_TrackedDb._WRITE_PREFIXES) and callable(target):
            return _Recorded(target, lambda fn, a, kw: ledger.wrote(name, fn, a, kw))
        return target


class _Ledger:
    def __init__(self):
        self.events = []  # ("write", name) / ("notify", topics)
        self.violations = []
        self._dirty = None  # the first write since the last notify carrying `tree`

    def wrote(self, name, fn, args, kwargs):
        result = fn(*args, **kwargs)
        self.events.append(("write", name))
        if self._dirty is None:
            self._dirty = name
        return result

    def notified(self, topics, fn):
        if not topics:
            self.violations.append("notify() called with no topics")
        elif not set(topics) <= _NOTIFY_TOPICS:
            self.violations.append(
                f"notify{topics} names a topic outside the vocabulary"
            )
        self.events.append(("notify", topics))
        if self._dirty is not None:
            if "tree" in topics:
                self._dirty = None
            else:
                self.violations.append(
                    f"{self._dirty} wrote, then notify{topics} fired without 'tree'"
                )
                self._dirty = None
        return fn(*topics)


@pytest.fixture(autouse=True)
def notify_ledger(monkeypatch):
    """Runs every test over a recording `db_client`; fails on a write not followed by a notify
    carrying `tree`; a test that never notified (a bare executor call) has no flow to check."""

    import sys

    from services import db_client

    ledger = _Ledger()
    tracked = _TrackedDb(db_client, ledger)
    for mod in list(sys.modules.values()):
        try:
            if getattr(mod, "db_client", None) is db_client:
                monkeypatch.setattr(mod, "db_client", tracked)
        except Exception:  # an exotic module in sys.modules is not ours
            pass
    yield ledger
    flow_ran = any(kind == "notify" for kind, _ in ledger.events)
    if ledger._dirty is not None and flow_ran:
        ledger.violations.append(
            f"{ledger._dirty} wrote and no notify with 'tree' followed"
        )
    assert not ledger.violations, "\n".join(ledger.violations)
