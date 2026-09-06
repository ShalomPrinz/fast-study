# lib/logging

`setup_logging()` plus the `AccessFilter` / `AccessFormatter` behind it, shared by `backend/` and
`database/`. Called once at each service's `main.py` import — after uvicorn's own `dictConfig`, so it
wins.

It sets the root logger to INFO with `[%(name)s] %(message)s`, silences `httpx`'s per-request INFO
line (one per Groq chunk, one per inter-service call), drops the routine access lines the frontend
fires constantly (HEAD/OPTIONS probes and successful GETs), and rewrites what survives to
`[api] POST /path → 200`.

## The module is `logging_setup.py`, never `logging.py`

The folder is `lib/logging`; the module inside `py/` is `logging_setup`. `py-modules` installs a *top-level*
name into each consumer's venv, so a module named `logging` here would shadow the standard library's
`logging` for that entire service — including for every dependency that imports it. The folder name
is safe because nothing installs the folder; the file name is not.

## Python only

Deliberate, not an oversight: the Node services log through plain `console` and have nothing worth
sharing. There is no `js/` sibling to `py/`, and the empty slot is intentional; if that changes, a
`logging.js` half belongs in a `js/` folder here.

## Tests

`py/tests/test_logging_setup.py` — `uv run --extra test pytest` from `py/`. It is the single copy;
neither service keeps its own.
