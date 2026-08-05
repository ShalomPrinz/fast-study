# EVENTS — the cross-service notify channel

This service owns the only SSE channel in the app. `GET /events` is a long-lived
`text/event-stream`; each subscriber gets its own `asyncio.Queue`, and `POST /notify` fans an
`event: notify` message out to all of them. A `: connected` comment is sent immediately so
proxies and clients see the stream open before any real traffic.

The event carries **no payload** — the body of `/notify` is drained and discarded. It is a
"something changed, refetch" ping, which keeps producers from having to model what changed and
keeps the channel a single event type. Producers are the backend (each meaningful pipeline and
course-overview state change, via `services/db_client.notify`) and the downloader server (after a
successful upload).

Delivery is fire-and-forget: per-queue failures are swallowed, and producers neither wait nor
retry. A missed notify costs a stale view until the next one, never a blocked producer.

## Shutdown

Streams are closed from a **signal handler**, not from lifespan shutdown. The lifespan hook
chains `SIGINT`/`SIGTERM`: it calls `close_all()` (pushing a sentinel into every queue, which
ends each generator) and then delegates to the previous handler, normally uvicorn's
`handle_exit`.

It cannot be done on lifespan shutdown, because uvicorn waits for open connections to close
*before* running it — an idle `/events` stream would deadlock that wait until force-quit, then be
cancelled mid-response and print an ASGI traceback on every Ctrl-C.

If the previous handler is `SIG_DFL`/`SIG_IGN` rather than a callable — i.e. uvicorn isn't the
signal owner — the handler restores it and re-raises, so shutdown still happens.
