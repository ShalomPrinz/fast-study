import asyncio
from typing import AsyncIterator

_subscribers: set[asyncio.Queue] = set()


async def subscribe() -> AsyncIterator[str]:
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.add(queue)
    try:
        yield ": connected\n\n"
        while True:
            msg = await queue.get()
            yield msg
    finally:
        _subscribers.discard(queue)


def broadcast_notify() -> None:
    msg = "event: notify\ndata: {}\n\n"
    for q in list(_subscribers):
        try:
            q.put_nowait(msg)
        except Exception:
            pass
