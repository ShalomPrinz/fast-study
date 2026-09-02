import os
import socket

import uvicorn


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
