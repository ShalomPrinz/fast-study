import logging


class AccessFilter(logging.Filter):
    """Drop the routine access lines the frontend fires constantly: HEAD probes and successful GETs."""

    def filter(self, record):
        args = record.args
        if not isinstance(args, tuple) or len(args) != 5:
            return True
        _, method, _, _, status = args
        if method == "HEAD":
            return False
        return not (method == "GET" and isinstance(status, int) and 200 <= status < 300)


class AccessFormatter(logging.Formatter):
    """Format uvicorn access records as `[api] POST /path → 200` — no client address, HTTP version or status text."""

    def format(self, record):
        args = record.args
        if not isinstance(args, tuple) or len(args) != 5:
            return super().format(record)
        _, method, path, _, status = args
        return f"[api] {method} {path} → {status}"


def setup_logging():
    """Configure root logging and rewrite uvicorn's access log; call once at app-module import."""

    logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s", force=True)
    access = logging.getLogger("uvicorn.access")
    access.addFilter(AccessFilter())
    for handler in access.handlers:
        handler.setFormatter(AccessFormatter())
