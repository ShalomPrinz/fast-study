import threading

import backend_main
from fastapi.testclient import TestClient
from pipeline import schedule


def test_startup_notifies_once(monkeypatch):
    """A restarted backend pings the notify channel so a page showing a dead run refetches /status."""
    fired = threading.Event()
    calls = []

    def fake_notify():
        calls.append(1)
        fired.set()

    monkeypatch.setattr(backend_main.db_client, "notify", fake_notify)
    monkeypatch.setattr(schedule, "start", lambda: None)
    monkeypatch.setattr(schedule, "shutdown", lambda: None)
    with TestClient(backend_main.app):
        assert fired.wait(2)
    assert calls == [1]
