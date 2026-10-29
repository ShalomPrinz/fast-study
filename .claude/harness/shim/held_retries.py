"""Held Gemini auto-retry timers: the backend's runners arm a retry with `loop.call_later`; here the
handle never fires on its own and a harness-only route fires it. No import side effects."""

HELD: list = []


class HeldHandle:
    """Stands in for asyncio.TimerHandle: cancellable, never fires by itself."""

    def __init__(self, callback, args):
        self.callback = callback
        self.args = args
        self._cancelled = False
        self.fired = False

    def cancel(self):
        self._cancelled = True

    def cancelled(self):
        return self._cancelled

    @property
    def key(self):
        """`course/lecture/kind` for a lecture step, `course/slug` for an overview analyze."""

        parts = self.args[0].split("||") if len(self.args) == 1 else list(self.args)
        return "/".join(parts)


class _Loop:
    def __init__(self, loop, held):
        self._loop = loop
        self._held = held

    def call_later(self, _delay, callback, *args):
        # Only the runners' `_fire_retry` timers are held; any other timer keeps its real delay.
        if getattr(callback, "__name__", "") != "_fire_retry":
            return self._loop.call_later(_delay, callback, *args)
        handle = HeldHandle(callback, args)
        self._held.append(handle)
        return handle

    def __getattr__(self, name):
        return getattr(self._loop, name)


class _Asyncio:
    def __init__(self, real, held):
        self._real = real
        self._held = held

    def get_running_loop(self):
        return _Loop(self._real.get_running_loop(), self._held)

    def __getattr__(self, name):
        return getattr(self._real, name)


def hold_timers(module, held=HELD):
    """Swap the module's `asyncio` for a proxy whose loop holds retry timers."""

    module.asyncio = _Asyncio(module.asyncio, held)


def fire(key=None, held=HELD):
    """Run every held, uncancelled retry (or those under `key`) now, on the caller's loop; return their keys."""

    fired = []
    for handle in list(held):
        if handle.cancelled() or handle.fired:
            held.remove(handle)
            continue
        if key and handle.key != key and not handle.key.startswith(key + "/"):
            continue
        handle.fired = True
        held.remove(handle)
        handle.callback(*handle.args)
        fired.append(handle.key)
    return fired
