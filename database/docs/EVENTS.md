# EVENTS — the cross-service notify channel

This service owns the only SSE channel in the app. `GET /events` is a long-lived
`text/event-stream`; each subscriber gets its own `asyncio.Queue`, and `POST /notify` fans an
`event: notify` message out to all of them. A `: connected` comment is sent immediately so
proxies and clients see the stream open before any real traffic.

The event name stays `notify`; the topics ride in `data`: `data: {"topics":["runner","tree"]}`.
An untagged notify is `data: {}`. `POST /notify` reads an optional JSON body `{"topics": [...]}`
and relays the list as is; a missing, empty or unparsable body, or one without a list of strings
under `topics`, broadcasts untagged and never fails the request. The database does not validate
names against the vocabulary.

| Topic      | Means                                                          |
| ---------- | -------------------------------------------------------------- |
| `runner`   | the backend's live state: `/status`, course `/status`, notices |
| `tree`     | disk state: `/tree`, course files, course meta                 |
| `settings` | `/config` changed (data root, course-structure mode)           |
| `drive`    | Drive consent or connection changed                            |

A notify may carry several topics. **No topics means everything, and so does any topic a consumer
does not know**, so a missed or misspelled tag degrades to a full refetch.

Producers are the backend (each meaningful pipeline and course-overview state change, via
`services/db_client.notify`), the downloader server (after a successful upload), and this service
itself: every mutation route tags `tree` on success except the raw file writes and deletes, which
broadcast nothing: `PUT …/video`, `POST …/materials`, `PUT …/files/{name}`, `DELETE …/files/{name}`,
`PUT …/figures/{name}`, `DELETE …/figures`, `PUT …/overview/files/{name}` and
`PATCH …/overview/meta`. Their caller writes several files per job, so it sends its
own `tree` notify once its writes are done and a multi-file write pings once.
`PATCH /courses/{course}/source_url` broadcasts nothing and nobody notifies for it: its only caller is the
frontend, which refetches the course tree itself after the call. `POST /config` tags
`settings` + `tree` when it applies a new `data_root` or `course_structure`.

A route that calls `broadcast_notify(*topics)` is `async def`: the queues are plain `asyncio.Queue`s, not thread-safe, so a push from a threadpool worker can be lost or wake no one.

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
