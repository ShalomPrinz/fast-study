import importlib
import json

import database_main
import pytest
import sentry_sdk
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport

FAKE_DSN = "https://public@o0.ingest.de.sentry.io/0"


class _Capture(Transport):
    """An in-memory transport: keeps every envelope instead of sending it."""

    def __init__(self, options=None):
        """Start with no envelopes captured."""

        super().__init__(options)
        self.envelopes = []

    def capture_envelope(self, envelope):
        """Record the envelope the client would have sent."""

        self.envelopes.append(envelope)


@pytest.fixture
def reload_main(monkeypatch):
    """Re-run database_main's import-time init under the test's env, then disarm Sentry again."""

    calls = []
    real_init = sentry_sdk.init

    def init(**kwargs):
        """Record the init and point it at the test's transport."""

        calls.append(kwargs)
        return real_init(**kwargs, transport=reload.transport)

    def reload():
        """Reload the module so its module-level init runs again."""

        importlib.reload(database_main)
        return calls

    reload.transport = _Capture()
    monkeypatch.setattr(sentry_sdk, "init", init)
    yield reload
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)
    monkeypatch.delenv("FASTSTUDY_SENTRY_DSN", raising=False)
    monkeypatch.undo()
    importlib.reload(database_main)


def test_no_dsn_skips_init(reload_main, monkeypatch):
    """With no DSN the SDK is never initialised."""

    monkeypatch.delenv("FASTSTUDY_SENTRY_DSN", raising=False)
    assert reload_main() == []
    assert not sentry_sdk.get_client().is_active()


def test_unhandled_route_error_reports_scrubbed_event(
    reload_main, monkeypatch, tmp_path
):
    """An exception escaping a route becomes one event tagged database, with the Hebrew DATA_ROOT redacted."""

    root = tmp_path / "הרצאות"
    monkeypatch.setenv("DATA_ROOT", str(root))
    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", FAKE_DSN)
    assert len(reload_main()) == 1

    leaked = f"{root}/קורס/הרצאה 1/video.mp4"

    @database_main.app.get("/boom")
    def boom():
        """Fail with a path under DATA_ROOT in the message."""

        raise RuntimeError(f"cannot open {leaked}")

    client = TestClient(database_main.app, raise_server_exceptions=False)
    assert client.get("/boom").status_code == 500

    events = [e.get_event() for e in reload_main.transport.envelopes]
    events = [e for e in events if e]
    assert len(events) == 1
    event = events[0]
    assert event["tags"]["service"] == "database"
    value = event["exception"]["values"][-1]["value"]
    assert value == "cannot open <data>"
    dumped = json.dumps(event, ensure_ascii=False, default=str)
    assert str(root) not in dumped
    assert "הרצאות" not in dumped
