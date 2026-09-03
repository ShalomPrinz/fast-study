import os
import socket
from pathlib import Path
from secrets import compare_digest
from urllib.parse import parse_qs

import uvicorn
from dotenv import load_dotenv

# Loaded here, not in main.py: every module that reads env at import time imports `runtime` first,
# so this is the only placement that survives an import re-sort.
load_dotenv()

_SECRET_HEADER = b"x-faststudy-secret"
_UNAUTHORIZED = b'{"error": "unauthorized"}'

# This file is `<repo>/backend/runtime.py`, so the repo root is two levels up.
_REPO_ROOT = Path(__file__).resolve().parent.parent


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
    """Answers 401 to any request carrying neither the `X-FastStudy-Secret` header nor a
    `secret` query parameter — EventSource is the one caller that cannot set a header."""

    # Pure ASGI, never BaseHTTPMiddleware: that one buffers a StreamingResponse and would stall SSE.
    def __init__(self, app, secret: str):
        self.app = app
        self.secret = secret.encode()

    async def __call__(self, scope, receive, send):
        # /health is the sole exemption, so the launcher can tell a wrong secret from a dead child.
        exempt = scope["type"] != "http" or scope["path"] == "/health"
        if exempt or self._authorized(scope):
            await self.app(scope, receive, send)
            return
        await self._reject(scope, send)

    def _authorized(self, scope) -> bool:
        given = (
            dict(scope["headers"]).get(_SECRET_HEADER)
            or parse_qs(scope["query_string"]).get(b"secret", [b""])[0]
        )
        return compare_digest(given, self.secret)

    async def _reject(self, scope, send) -> None:
        """An SSE request is refused as an empty `text/event-stream`: Chromium reports any other
        MIME on an EventSource as a bare transport error, hiding the auth failure."""

        sse = b"text/event-stream" in dict(scope["headers"]).get(b"accept", b"")
        body = b"" if sse else _UNAUTHORIZED
        ctype = b"text/event-stream" if sse else b"application/json"
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", ctype),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def serve(app, default_port: int) -> None:
    """Serve `app` on loopback, printing `FASTSTUDY_PORT=<port>` so the launcher can read it.
    The socket is bound here because `uvicorn.run(port=0)` offers no way to learn what it bound."""

    port = int(os.environ.get("FASTSTUDY_PORT", default_port))
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    # Listen before announcing, so a launcher connecting the instant it reads the line is not refused.
    sock.listen()
    print(f"FASTSTUDY_PORT={sock.getsockname()[1]}", flush=True)
    uvicorn.Server(uvicorn.Config(app)).run(sockets=[sock])
