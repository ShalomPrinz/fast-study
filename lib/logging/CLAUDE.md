# lib/logging

`setup_logging()` plus the `AccessFilter` / `AccessFormatter` behind it, shared by `backend/` and
`database/`. Called once at each service's entry-module import, under `runtime.serve()` and under a
bare `uvicorn` CLI alike.

It sets the root logger to INFO with `[%(name)s] %(message)s`, silences `httpx`'s per-request INFO
line (one per Groq chunk, one per inter-service call), drops the routine access lines the frontend
fires constantly (HEAD/OPTIONS probes and successful GETs), and rewrites what survives to
`[api] POST /path → 200`.

## It owns the `uvicorn.access` handler outright

`setup_logging()` installs its own `StreamHandler` on `uvicorn.access` and sets `propagate = False`,
rather than re-formatting a handler it finds there. The last writer to that logger wins, and
`setup_logging()` is always last: packaged, `serve()` passes `log_config=None` so uvicorn never
configures the logger at all; under the `uvicorn` CLI, uvicorn configures it before importing the
entry module and `setup_logging()` replaces its handler list outright. Both paths end up identical —
which is exactly why wiring that re-formats whatever handler it finds works in dev and silently
loses the `[api]` format only in the packaged build, where there is no handler to find. Revert either
half and the packaged access log falls back to uvicorn's raw
`127.0.0.1:52344 - "POST /nope HTTP/1.1" 404` line while dev still looks correct.

The filter is on the *logger*, so it survives any handler churn; the formatter is on the *handler*,
so it does not. That asymmetry is why a broken wiring drops the right lines while printing the
surviving ones in the wrong format — the symptom to recognize.

Handler and root both write to **stderr**. uvicorn's own default sends the access log to *stdout*,
which is the port-handshake channel `runtime.serve()` prints `FASTSTUDY_PORT=<n>` on, so keeping it
off stdout is deliberate.

## The module is `logging_setup.py`, never `logging.py`

The folder is `lib/logging`; the module inside `py/` is `logging_setup`. `py-modules` installs a _top-level_
name into each consumer's venv, so a module named `logging` here would shadow the standard library's
`logging` for that entire service — including for every dependency that imports it. The folder name
is safe because nothing installs the folder; the file name is not.

## Python only

Deliberate, not an oversight: the Node services log through plain `console` and have nothing worth
sharing. There is no `js/` sibling to `py/`, and the empty slot is intentional; if that changes, a
`logging.js` half belongs in a `js/` folder here.

## Tests

`py/tests/test_logging_setup.py` — `uv run --extra test pytest` from `py/`. It is the single copy;
neither service keeps its own. Beyond the filter/formatter cases it asserts the *wiring*
`setup_logging()` leaves behind — the filter present, one handler carrying `AccessFormatter`,
`propagate` off — because the classes can each be correct while nothing is attached to the logger.
