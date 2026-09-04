import pytest
import runtime
from fastapi import FastAPI
from starlette.testclient import TestClient

SECRET = "s3cr3t"


@pytest.fixture
def client(monkeypatch):
    """A throwaway app with the real secret check installed, driven over the ASGI transport."""

    monkeypatch.setenv("FASTSTUDY_SECRET", SECRET)
    app = FastAPI()

    @app.get("/health")
    @app.post("/health")
    @app.get("/events")
    @app.get("/thing")
    def ok():
        return {"ok": True}

    runtime.install_secret_check(app)
    # raise_server_exceptions stays default: nothing here is expected to raise, and a 500 would
    # otherwise be indistinguishable from the 401 the tests are asserting.
    return TestClient(app)


def test_get_health_needs_no_secret(client):
    assert client.get("/health").status_code == 200


def test_post_health_is_not_exempt(client):
    """The exemption is GET-only; a write to the same path still needs the secret."""

    assert client.post("/health").status_code == 401


def test_correct_header_passes(client):
    assert (
        client.get("/thing", headers={"X-FastStudy-Secret": SECRET}).status_code == 200
    )


def test_correct_query_param_passes(client):
    """EventSource cannot set a header, so `?secret=` is the credential it sends instead."""

    assert client.get("/thing", params={"secret": SECRET}).status_code == 200


def test_wrong_header_does_not_shadow_correct_query_param(client):
    response = client.get(
        "/thing", params={"secret": SECRET}, headers={"X-FastStudy-Secret": "nope"}
    )
    assert response.status_code == 200


def test_blank_header_does_not_shadow_correct_query_param(client):
    response = client.get(
        "/thing", params={"secret": SECRET}, headers={"X-FastStudy-Secret": ""}
    )
    assert response.status_code == 200


def test_missing_secret_is_rejected(client):
    assert client.get("/thing").status_code == 401


def test_sse_401_keeps_the_event_stream_mime(client):
    """Chromium reports any other MIME on an EventSource as a bare transport error."""

    response = client.get("/events", headers={"Accept": "text/event-stream"})
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("text/event-stream")


def test_non_sse_401_is_json(client):
    response = client.get("/thing")
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"error": "unauthorized"}


def test_unset_secret_installs_nothing(monkeypatch):
    """Dev runs with no FASTSTUDY_SECRET, and then nothing is enforced at all."""

    monkeypatch.delenv("FASTSTUDY_SECRET", raising=False)
    app = FastAPI()

    @app.get("/thing")
    def thing():
        return {"ok": True}

    runtime.install_secret_check(app)
    assert TestClient(app).get("/thing").status_code == 200
