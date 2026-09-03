import os
import secrets
import socket
from urllib.parse import parse_qs

import uvicorn
from starlette.responses import JSONResponse, Response


def _header(scope, name: bytes) -> bytes:
    """Read one header out of an ASGI scope, whose headers are a list of lowercase byte pairs."""

    return next((value for key, value in scope["headers"] if key == name), b"")


class SecretMiddleware:
    """Reject every request that carries neither the X-FastStudy-Secret header nor a matching `secret` query parameter."""

    # Pure ASGI on purpose: BaseHTTPMiddleware buffers a StreamingResponse, which would stall /events.

    def __init__(self, app, secret: str):
        """Wrap app, checking each HTTP request against the launch secret."""

        self.app = app
        # Kept as bytes: compare_digest refuses a str holding any non-ASCII character, so a
        # malformed secret would raise instead of being rejected.
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
        return secrets.compare_digest(header, self.secret) or secrets.compare_digest(
            param, self.secret
        )


def install_secret_check(app) -> None:
    """Require the launch secret on every request but GET /health; an unset FASTSTUDY_SECRET (dev) installs nothing."""

    secret = os.environ.get("FASTSTUDY_SECRET")
    if secret:
        # Installed before CORSMiddleware: Starlette builds the stack outermost-from-last, and a 401 thrown
        # from outside CORS reaches the browser as a network error rather than an auth failure.
        app.add_middleware(SecretMiddleware, secret=secret)


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
