import os
import socket

import uvicorn


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
