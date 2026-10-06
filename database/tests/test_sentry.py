import importlib
import json

import database_main
import pytest
import sentry_policy
import sentry_sdk
from fastapi.testclient import TestClient
from sentry_sdk.transport import HttpTransport, Transport

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

    def events(self):
        """The error events captured so far."""

        return [e.get_event() for e in self.envelopes if e.get_event()]


@pytest.fixture
def reload_main(monkeypatch):
    """Re-run database_main's import-time init under the test's env, then disarm Sentry again.
    Reporting starts off, as with no FASTSTUDY_ERROR_REPORTS; a test that expects events turns it on."""

    calls = []
    real_init = sentry_sdk.init

    def init(**kwargs):
        """Record the init and point it at the test's transport, gated like the real one."""

        calls.append(kwargs)
        return real_init(**{**kwargs, "transport": reload.transport})

    def reload():
        """Reload the module so its module-level init runs again; boot-time events are dropped."""

        importlib.reload(database_main)
        reload.transport.envelopes.clear()
        return calls

    reload.transport = sentry_policy.gated(_Capture)()
    monkeypatch.setattr(sentry_sdk, "init", init)
    was_reporting = sentry_policy.reporting()
    sentry_policy.set_reporting(False)
    yield reload
    sentry_policy.set_reporting(was_reporting)
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)
    sentry_sdk.get_isolation_scope().clear()
    monkeypatch.delenv("FASTSTUDY_SENTRY_DSN", raising=False)
    monkeypatch.undo()
    importlib.reload(database_main)


def test_no_dsn_skips_init(reload_main, monkeypatch):
    """With no DSN the SDK is never initialised."""

    monkeypatch.delenv("FASTSTUDY_SENTRY_DSN", raising=False)
    assert reload_main() == []
    assert not sentry_sdk.get_client().is_active()


def test_transport_is_the_gated_http_transport(reload_main, monkeypatch):
    """Init hands the SDK the policy's gated HttpTransport, so the switch governs real sends."""

    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", FAKE_DSN)
    (kwargs,) = reload_main()
    assert issubclass(kwargs["transport"], HttpTransport)
    assert kwargs["transport"] is not HttpTransport


def _boom_client():
    """A test client on the app with a /boom route that raises."""

    @database_main.app.get("/boom")
    def boom():
        """Fail on purpose."""

        raise RuntimeError("boom")

    return TestClient(database_main.app, raise_server_exceptions=False)


@pytest.mark.parametrize("on", [False, True])
def test_config_error_reports_switches_sending_live(reload_main, monkeypatch, on):
    """POST /config {error_reports} flips the gate on the running process: off sends nothing."""

    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", FAKE_DSN)
    sentry_policy.set_reporting(not on)
    reload_main()
    client = _boom_client()

    assert client.post("/config", json={"error_reports": on}).status_code == 204
    assert sentry_policy.reporting() is on

    assert client.get("/boom").status_code == 500
    assert len(reload_main.transport.events()) == (1 if on else 0)


def test_config_error_reports_rejects_a_non_boolean(reload_main):
    """A string "false" is refused rather than read as truthy, and the switch stays put."""

    client = TestClient(database_main.app)
    response = client.post("/config", json={"error_reports": "false"})
    assert response.status_code == 400
    assert response.json()["code"] == "setting_must_be_boolean"
    assert sentry_policy.reporting() is False


def test_unhandled_route_error_reports_scrubbed_event(
    reload_main, monkeypatch, tmp_path
):
    """An exception escaping a route becomes one event tagged database, with the Hebrew DATA_ROOT redacted."""

    root = tmp_path / "הרצאות"
    monkeypatch.setenv("DATA_ROOT", str(root))
    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", FAKE_DSN)
    sentry_policy.set_reporting(True)
    assert len(reload_main()) == 1

    leaked = f"{root}/קורס/הרצאה 1/video.mp4"

    @database_main.app.get("/boom")
    def boom():
        """Fail with a path under DATA_ROOT in the message."""

        raise RuntimeError(f"cannot open {leaked}")

    client = TestClient(database_main.app, raise_server_exceptions=False)
    assert client.get("/boom").status_code == 500

    events = reload_main.transport.events()
    assert len(events) == 1
    event = events[0]
    assert event["tags"]["service"] == "database"
    value = event["exception"]["values"][-1]["value"]
    assert value == "cannot open <data>"
    dumped = json.dumps(event, ensure_ascii=False, default=str)
    assert str(root) not in dumped
    assert "הרצאות" not in dumped
