import os
import re
import socket
import subprocess
import sys
from pathlib import Path

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


def test_duplicate_header_is_rejected_wrong_then_right(client):
    """`_header()` folds repeats into one comma-joined value, so a duplicated credential matches nothing."""

    response = client.get(
        "/thing",
        headers=[("X-FastStudy-Secret", "nope"), ("X-FastStudy-Secret", SECRET)],
    )
    assert response.status_code == 401


def test_duplicate_header_is_rejected_right_then_wrong(client):
    """Asserted both ways: the correct value in front must not authenticate an ambiguous request either."""

    response = client.get(
        "/thing",
        headers=[("X-FastStudy-Secret", SECRET), ("X-FastStudy-Secret", "nope")],
    )
    assert response.status_code == 401


def test_duplicate_accept_still_selects_the_event_stream_401(client):
    """`_header` folds every header, so the SSE substring check has to survive a comma-joined Accept."""

    response = client.get(
        "/events",
        headers=[("Accept", "text/event-stream"), ("Accept", "application/json")],
    )
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("text/event-stream")


def test_duplicate_query_parameter_is_rejected(client):
    """One `secret` parameter or none — a repeated one is a 401 in both languages."""

    assert client.get(f"/thing?secret={SECRET}&secret=junk").status_code == 401


def test_duplicate_query_parameter_is_rejected_in_either_order(client):
    """Asserted both ways, so relaxing the guard back to first-wins fails here."""

    assert client.get(f"/thing?secret=junk&secret={SECRET}").status_code == 401


def test_blank_duplicate_query_parameter_is_rejected_after_the_secret(client):
    """A blank duplicate is still a duplicate; without keep_blank_values it would collapse to one value."""

    assert client.get(f"/thing?secret={SECRET}&secret=").status_code == 401


def test_blank_duplicate_query_parameter_is_rejected_before_the_secret(client):
    """The mirror form, which express also refuses — it parses both to a two-element array."""

    assert client.get(f"/thing?secret=&secret={SECRET}").status_code == 401


def test_valueless_duplicate_query_parameter_is_rejected(client):
    """A bare `&secret` with no `=` is the third blank form, and counts as a second value too."""

    assert client.get(f"/thing?secret={SECRET}&secret").status_code == 401


def test_single_blank_query_parameter_is_rejected(client):
    """One blank value is a credential that matches nothing, not an absent parameter."""

    assert client.get("/thing?secret=").status_code == 401


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


# serve() is driven in a child process because both of its outcomes end the process: a bind failure
# exits 1, and a success hands the socket to uvicorn and never returns.
_PACKAGE_DIR = Path(runtime.__file__).resolve().parent
_CHILD = "import runtime; from starlette.applications import Starlette; runtime.serve(Starlette(), 0)"


@pytest.fixture
def taken_port():
    """A port held open for the whole test, so a child binding it must fail."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen()
        yield sock.getsockname()[1]


def _child(port: int, **kwargs) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-c", _CHILD],
        cwd=_PACKAGE_DIR,
        env={**os.environ, "FASTSTUDY_PORT": str(port)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        **kwargs,
    )


def test_successful_bind_announces_the_port_on_stdout():
    """The launcher matches `^FASTSTUDY_PORT=(\\d+)$`, so the line stands alone and carries the real port."""

    process = _child(0)
    try:
        line = process.stdout.readline()
        assert re.fullmatch(r"FASTSTUDY_PORT=\d+", line.strip())
    finally:
        process.kill()
        process.wait(timeout=10)


def test_failed_bind_names_the_address_and_errno_on_stderr(taken_port):
    """One stderr line and exit 1, in the shape runtime.js prints — never a traceback."""

    process = _child(taken_port)
    stdout, stderr = process.communicate(timeout=30)
    assert process.returncode == 1
    assert f"cannot bind 127.0.0.1:{taken_port}" in stderr
    assert "EADDRINUSE" in stderr
    # stdout is the launcher's handshake channel and must carry nothing when the bind failed.
    assert "FASTSTUDY_PORT=" not in stdout
