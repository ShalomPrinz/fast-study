import os
import secrets
import socket
from pathlib import Path
from urllib.parse import parse_qs

import uvicorn
from dotenv import load_dotenv
from starlette.responses import JSONResponse, Response

# Loaded here, not in main.py: every module that reads env at import time imports `runtime` first,
# so this is the only placement that survives an import re-sort.
load_dotenv()

# This file is `<repo>/lib/runtime/runtime.py`, so the repo root is three levels up. An editable
# install leaves `__file__` pointing at this source file, so the depth holds in every consumer.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _header(scope, name: bytes) -> bytes:
    """Read one header out of an ASGI scope, whose headers are a list of lowercase byte pairs."""

    return next((value for key, value in scope["headers"] if key == name), b"")


def secret() -> str | None:
    """The launch secret every caller must present. Unset means no enforcement at all,
    which is what dev runs on."""

    return os.environ.get("FASTSTUDY_SECRET") or None


def state_path(*parts) -> Path:
    """The writable state root with `parts` joined onto it: `FASTSTUDY_STATE_DIR` if set,
    else `.state/` at the repo root."""

    # A pure join that deliberately creates nothing: importing a module that merely names a
    # state file must not leave a directory behind, least of all one redirected elsewhere.
    root = os.environ.get("FASTSTUDY_STATE_DIR") or _REPO_ROOT / ".state"
    return Path(root).joinpath(*parts)


class SecretMiddleware:
    """Reject every request that carries neither the X-FastStudy-Secret header nor a matching `secret` query parameter."""

    # Pure ASGI on purpose: BaseHTTPMiddleware buffers a StreamingResponse, which would stall /events.

    def __init__(self, app, secret: str):
        """Wrap app, checking each HTTP request against the launch secret."""

        self.app = app
        # Kept as bytes: compare_digest refuses a str holding any non-ASCII character, so a
        # malformed secret would raise instead of being rejected. latin-1 matches the latin-1
        # decode of the query string, so an arbitrary byte round-trips to what was sent.
        self.secret = secret.encode("latin-1")

    async def __call__(self, scope, receive, send):
        """Pass an authorized request through; answer everything else 401."""

        if scope["type"] != "http" or self._authorized(scope):
            await self.app(scope, receive, send)
            return
        # EventSource aborts any other MIME with a bare onerror, so an SSE 401 must still look like a stream.
        if b"text/event-stream" in _header(scope, b"accept"):
            response = Response(status_code=401, media_type="text/event-stream")
        else:
            response = JSONResponse({"error": "unauthorized"}, status_code=401)
        await response(scope, receive, send)

    def _authorized(self, scope) -> bool:
        """Accept GET /health unconditionally, else the secret from either the header or the query parameter."""

        # /health answers without the secret, or the launcher cannot tell a wrong secret from a dead child.
        if scope["method"] == "GET" and scope["path"] == "/health":
            return True
        header = _header(scope, b"x-faststudy-secret")
        # The query parameter exists because native EventSource is the one caller that cannot set a
        # header. latin-1 both ways, so an arbitrary byte round-trips back to what was sent.
        query = parse_qs(scope["query_string"].decode("latin-1"), encoding="latin-1")
        param = query.get("secret", [""])[0].encode("latin-1")
        # Tried independently rather than `header or param`: a wrong or blank header must not
        # shadow the query parameter, which is the only credential EventSource can send.
        return secrets.compare_digest(header, self.secret) or secrets.compare_digest(
            param, self.secret
        )


def install_secret_check(app) -> None:
    """Require the launch secret on every request but GET /health; an unset FASTSTUDY_SECRET (dev) installs nothing."""

    launch_secret = secret()
    if launch_secret:
        # Installed before CORSMiddleware: Starlette builds the stack outermost-from-last, and a 401 thrown
        # from outside CORS reaches the browser as a network error rather than an auth failure.
        app.add_middleware(SecretMiddleware, secret=launch_secret)


def serve(app, default_port: int) -> None:
    """Serve app on loopback at FASTSTUDY_PORT (0 asks for an ephemeral one), reporting the bound port on stdout."""

    # Bound by hand because uvicorn never reports what `port=0` resolved to, and the launcher has
    # to read the real port back to reach this service.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", int(os.environ.get("FASTSTUDY_PORT", default_port))))
    # Listen before announcing, so a launcher connecting the instant it reads the line is not refused.
    sock.listen()
    print(f"FASTSTUDY_PORT={sock.getsockname()[1]}", flush=True)
    uvicorn.Server(uvicorn.Config(app)).run(sockets=[sock])
