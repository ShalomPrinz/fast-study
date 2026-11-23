import asyncio
import threading


class Gate:
    """Fake parks in `block()` until `open()`; `reached(n)` awaits n fakes parking, by which point the
    lock they sit under is held and any later run is queued behind it."""

    def __init__(self):
        self._reached = threading.Semaphore(0)
        self._open = threading.Event()

    def block(self):
        self._reached.release()
        self._open.wait(timeout=5)

    def open(self):
        self._open.set()

    async def reached(self, n=1):
        def acquire():
            return all(self._reached.acquire(timeout=5) for _ in range(n))

        assert await asyncio.to_thread(acquire), "fake never reached block()"
