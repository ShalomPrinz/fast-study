import asyncio
import json
from typing import AsyncIterator

_subscribers: set[asyncio.Queue] = set()

# Sentinel that ends a subscriber's stream; never sent as a real SSE message.
_SHUTDOWN = object()


async def subscribe() -> AsyncIterator[str]:
    """Yield SSE-formatted messages for one subscriber until the client disconnects or the server shuts down."""

    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.add(queue)
    try:
        yield ": connected\n\n"
        while True:
            msg = await queue.get()
            if msg is _SHUTDOWN:
                return
            yield msg
    finally:
        _subscribers.discard(queue)


def close_all() -> None:
    """End every open stream so shutdown isn't blocked by idle subscribers uvicorn would otherwise cancel mid-response."""

    for q in list(_subscribers):
        q.put_nowait(_SHUTDOWN)


def broadcast_notify(*topics: str) -> None:
    """Fan a `notify` event carrying the topics (none = everything) out to every subscriber; per-queue failures are swallowed (fire-and-forget)."""

    # dict.fromkeys drops duplicates and keeps order.
    data = {"topics": list(dict.fromkeys(topics))} if topics else {}
    msg = f"event: notify\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"
    for q in list(_subscribers):
        try:
            q.put_nowait(msg)
        except Exception:
            pass
