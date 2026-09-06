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


def test_wrong_header_alone_is_rejected(client):
    """Distinct from the shadowing case: with no query parameter behind it, a wrong header is all there is."""

    assert (
        client.get("/thing", headers={"X-FastStudy-Secret": "nope"}).status_code == 401
    )


def test_malformed_byte_in_the_query_string_is_a_401_not_a_500(client):
    """A byte no utf-8 decoder accepts; decoding it as utf-8 would raise and Starlette would answer 500."""

    assert client.get("/thing?secret=%FF").status_code == 401


def test_malformed_byte_in_the_header_is_a_401_not_a_500(client):
    """Same reason as the query string, other input: the header is compared as raw bytes."""

    assert (
        client.get("/thing", headers={"X-FastStudy-Secret": b"\xff"}).status_code == 401
    )


def test_first_of_two_headers_wins_wrong_then_right(client):
    """The `_header()` generator lookup takes the first X-FastStudy-Secret, so a wrong one in front is fatal."""

    response = client.get(
        "/thing",
        headers=[("X-FastStudy-Secret", "nope"), ("X-FastStudy-Secret", SECRET)],
    )
    assert response.status_code == 401


def test_first_of_two_headers_wins_right_then_wrong(client):
    """The mirror assertion: one direction alone passes under either resolution and would catch no regression."""

    response = client.get(
        "/thing",
        headers=[("X-FastStudy-Secret", SECRET), ("X-FastStudy-Secret", "nope")],
    )
    assert response.status_code == 200


def test_duplicate_query_parameter_is_rejected(client):
    """One `secret` parameter or none — a repeated one is a 401 in both languages."""

    assert client.get(f"/thing?secret={SECRET}&secret=junk").status_code == 401


def test_duplicate_query_parameter_is_rejected_in_either_order(client):
    """Asserted both ways, so relaxing the guard back to first-wins fails here."""

    assert client.get(f"/thing?secret=junk&secret={SECRET}").status_code == 401


def test_secret_coerces_an_empty_env_var_to_none(monkeypatch):
    """An empty FASTSTUDY_SECRET reads as no enforcement, never as a secret nothing can match."""

    monkeypatch.setenv("FASTSTUDY_SECRET", "")
    assert runtime.secret() is None


def test_non_http_scope_passes_straight_through(client):
    """Entering the client runs the lifespan scope through the middleware; a regression there deadlocks startup."""

    with client:
        assert client.get("/health").status_code == 200


def test_sse_401_writes_nothing_into_the_stream(client):
    """EventSource surfaces a body it cannot parse as a bare error, so the 401 stream stays empty."""

    response = client.get("/events", headers={"Accept": "text/event-stream"})
    assert response.status_code == 401
    assert response.content == b""


def test_state_path_falls_back_to_dot_state_at_the_repo_root(monkeypatch):
    """Unset FASTSTUDY_STATE_DIR is dev, and the root is found from this file's fixed position in lib/runtime/py/."""

    monkeypatch.delenv("FASTSTUDY_STATE_DIR", raising=False)
    root = runtime.state_path()
    assert root.name == ".state"
    # The repo root is identified by markers rather than an absolute path, so the assertion survives
    # a checkout anywhere and still fails if the parent depth ever drifts.
    assert (root.parent / "package.json").is_file()
    assert (root.parent / "CLAUDE.md").is_file()


def test_state_path_honors_an_explicit_state_dir(monkeypatch, tmp_path):
    """The launcher passes FASTSTUDY_STATE_DIR explicitly in a packaged build, and it wins verbatim."""

    monkeypatch.setenv("FASTSTUDY_STATE_DIR", str(tmp_path))
    assert runtime.state_path("a", "b") == tmp_path / "a" / "b"


def test_state_path_creates_nothing(monkeypatch, tmp_path):
    """A pure join: naming a state file must never leave a directory behind, least of all a redirected one."""

    monkeypatch.setenv("FASTSTUDY_STATE_DIR", str(tmp_path / "nowhere"))
    path = runtime.state_path("a", "b")
    assert not path.exists()
    assert not path.parent.exists()
    assert not (tmp_path / "nowhere").exists()
