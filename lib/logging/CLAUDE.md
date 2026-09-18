# lib/logging

`setup_logging()` (`py/logging_setup.py`), shared by `backend/` and `database/` and called once at
each entry-module import, under `runtime.serve()` and a bare `uvicorn` CLI alike. It sets root to
INFO with `[%(name)s] %(message)s`, silences `httpx`'s per-request INFO line, drops routine access
lines (every HEAD/OPTIONS, every 2xx GET) and prints the rest as `[api] POST /path → 200`.

Tests: `cd py && uv run --extra test pytest`. The single copy — neither service keeps its own.

## It owns the `uvicorn.access` handler outright

It installs its own `StreamHandler` and sets `propagate = False` rather than re-formatting a handler
it finds, because the packaged build has none to find: `serve()` passes `log_config=None`, so
uvicorn never configures the logger. Under the CLI uvicorn configures it first and `setup_logging()`
replaces the handler list. Re-formatting instead works in dev and, packaged only, falls back to
uvicorn's raw `127.0.0.1:52344 - "POST /nope HTTP/1.1" 404` line.

The filter sits on the *logger* and survives handler churn; the formatter sits on the *handler* and
does not. So a broken wiring still drops the right lines but prints survivors in the raw format.

Everything writes to **stderr**: stdout is the `FASTSTUDY_PORT=<n>` handshake channel, where
uvicorn's default access handler would otherwise print.

The tests assert this wiring — filter attached, one handler carrying `AccessFormatter`, `propagate`
off — because both classes can be correct while nothing is attached to the logger.

## The module is `logging_setup.py`, never `logging.py`

`py-modules` installs a _top-level_ name into each consumer's venv, so a module named `logging`
would shadow the standard library for the whole service and every dependency. The folder name is
safe because nothing installs it.

## Python only

The Node services log through plain `console` and share nothing, so there is no `js/` half; one
would go in `js/` here if that changes.
