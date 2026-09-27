import asyncio
import importlib
import json
from unittest.mock import patch

import backend_main
import pytest
import sentry_sdk
from fastapi.testclient import TestClient
from pipeline import runner
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

    def events(self):
        """The error events captured so far."""

        return [e.get_event() for e in self.envelopes if e.get_event()]


@pytest.fixture
def reload_main(monkeypatch):
    """Re-run backend_main's import-time init under the test's env, then disarm Sentry again."""

    calls = []
    real_init = sentry_sdk.init

    def init(**kwargs):
        """Record the init and point it at the test's transport."""

        calls.append(kwargs)
        return real_init(**kwargs, transport=reload.transport)

    def reload():
        """Reload the module so its module-level init runs again; boot-time events are dropped."""

        importlib.reload(backend_main)
        reload.transport.envelopes.clear()
        return calls

    reload.transport = _Capture()
    monkeypatch.setattr(sentry_sdk, "init", init)
    yield reload
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)
    sentry_sdk.get_isolation_scope().clear()
    monkeypatch.delenv("FASTSTUDY_SENTRY_DSN", raising=False)
    monkeypatch.undo()
    importlib.reload(backend_main)


def test_no_dsn_skips_init(reload_main, monkeypatch):
    """With no DSN the SDK is never initialised."""

    monkeypatch.delenv("FASTSTUDY_SENTRY_DSN", raising=False)
    assert reload_main() == []
    assert not sentry_sdk.get_client().is_active()


def test_google_genai_integration_is_disabled(reload_main, monkeypatch):
    """Gemini calls are not instrumented: retried 429s and step failures must not become events."""

    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", FAKE_DSN)
    reload_main()
    client = sentry_sdk.get_client()
    assert client.is_active()
    assert client.get_integration("google_genai") is None


def test_unhandled_route_error_reports_scrubbed_event(reload_main, monkeypatch):
    """An exception escaping a route becomes one event tagged backend, its Hebrew path redacted."""

    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", FAKE_DSN)
    assert len(reload_main()) == 1

    @backend_main.app.get("/boom")
    def boom():
        """Fail with a Hebrew lecture path in the message."""

        raise RuntimeError("cannot open /lectures/מבני נתונים/הרצאה 1/video.mp4")

    client = TestClient(backend_main.app, raise_server_exceptions=False)
    response = client.get("/boom")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"  # the answer itself is unchanged

    events = reload_main.transport.events()
    assert len(events) == 1
    event = events[0]
    assert event["tags"]["service"] == "backend"
    value = event["exception"]["values"][-1]["value"]
    assert value == "cannot open /lectures/<hebrew>/<hebrew> 1/video.mp4"
    dumped = json.dumps(event, ensure_ascii=False, default=str)
    assert "מבני" not in dumped and "הרצאה" not in dumped


def test_pipeline_step_failure_reports_a_log_event(reload_main, monkeypatch):
    """A failed step is caught and stored, and its ERROR log line is what reaches Sentry."""

    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", FAKE_DSN)
    reload_main()

    async def fake_call(course, lecture, kind, step):
        return {"status": "error", "message": "boom"}

    async def go():
        with (
            patch.object(runner, "_call_step", fake_call),
            patch.object(runner.db_client, "notify"),
        ):
            await runner._run_step_unlocked("קורס", "הרצאה", "lecture", "transcribe")

    asyncio.run(go())
    runner._errors.pop(runner._skey("קורס", "הרצאה", "lecture"), None)

    events = reload_main.transport.events()
    assert len(events) == 1
    event = events[0]
    assert event["tags"]["service"] == "backend"
    assert event["level"] == "error"
    assert "<hebrew>/<hebrew>" in event["logentry"]["formatted"]
    assert "קורס" not in json.dumps(event, ensure_ascii=False, default=str)
