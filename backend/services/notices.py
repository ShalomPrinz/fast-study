"""Short-lived notices a run raises for the frontend to toast, read back through the status
endpoints. Each carries a unique id so a client shows it once; they expire after _TTL seconds."""

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

from services import db_client, llm_client

_TTL = 120
_lock = threading.Lock()
_notices: list[dict] = []
_next_id = int(time.time() * 1000)  # clock seed keeps ids increasing across restarts


def add(scope: str, code: str, params: dict, **where) -> None:
    """Record a notice under `scope` (the status read that returns it) and ping the SSE channel."""

    global _next_id
    now = time.time()
    with _lock:
        _next_id += 1
        _notices[:] = [n for n in _notices if now - n["_at"] < _TTL]
        _notices.append(
            {
                "id": _next_id,
                "code": code,
                "params": params,
                **where,
                "_at": now,
                "_scope": scope,
            }
        )
    db_client.notify()


def recent(scope: str) -> list[dict]:
    """The unexpired notices of `scope`, oldest first."""

    now = time.time()
    with _lock:
        return [
            {k: v for k, v in n.items() if not k.startswith("_")}
            for n in _notices
            if n["_scope"] == scope and now - n["_at"] < _TTL
        ]


@contextmanager
def record_fallbacks(scope: str, **where) -> Iterator[None]:
    """Within the block (a worker thread), a Gemini model fallback raises a `model_fallback`
    notice under `scope`; `where` rides on the notice."""

    def hook(from_model: str, to_model: str) -> None:
        add(scope, "model_fallback", {"from": from_model, "to": to_model}, **where)

    token = llm_client.fallback_hook.set(hook)
    try:
        yield
    finally:
        llm_client.fallback_hook.reset(token)
