# lib/runtime

The packaged launch contract, in both languages. `runtime.py` serves `backend/` and `database/`;
`runtime.js` serves `downloader/server` and `downloader/auto`. The frontend's
`src/services/runtime.ts` only reads the preload bridge — no server to bind, no secret to enforce —
and is deliberately not here.

## The two halves implement the same two contracts

They are separate files that agree on a contract, so **a change to one is a change to both**.

**The launcher handshake.** `serve()` binds `127.0.0.1` (never a public interface), then prints
exactly `FASTSTUDY_PORT=<port>` alone on a line, which the launcher matches as `^FASTSTUDY_PORT=(\d+)$`.
Python binds the socket by hand because `uvicorn.run(port=0)` never reports what it resolved to. The
line comes *after* `listen()`, so a launcher connecting the instant it reads it is not refused.

A failed bind is one line on **stderr** — `faststudy: cannot bind 127.0.0.1:8002 — EADDRINUSE
(address already in use)` — and exit 1, identical in both halves, with nothing on stdout: stdout is
the handshake channel, and a traceback there would read as a garbled port line. The JS half binds
with no listen callback and attaches `'listening'` / `'error'` itself, because express registers a
listen callback on `'error'` too and would hand it a null address.

**The launch-secret check.** Every request must carry `$FASTSTUDY_SECRET` as an `X-FastStudy-Secret`
header **or** a `secret` query parameter. The query parameter exists solely because native
`EventSource` cannot set a header; the two are tried independently, never `header or param`, so a
wrong or blank header cannot shadow the only credential an SSE caller can send. A 401 on a request
that asked for `text/event-stream` answers with that same MIME — Chromium reports any other MIME on
an `EventSource` as a bare transport error, hiding the auth failure behind a dropped connection.
Every other 401 answers `{error: 'unauthorized', code: 'unauthorized', params: {}}`, the envelope in
[`docs/ERROR-CODES.md`](../../docs/ERROR-CODES.md); the SSE one carries no body at all and so is the
one failure in the repo that cannot carry a code.
Comparison is constant-time on both sides (`compare_digest` / `timingSafeEqual`); JS checks length
first because `timingSafeEqual` throws on unequal buffers, and the length is fixed by the launcher,
not itself a secret.

## Nuances

- **`GET /health` is the only exemption**, so the launcher's boot screen can tell a wrong secret
  from a dead child. GET only: nothing else bypasses the check.
- **An unset `FASTSTUDY_SECRET` installs no enforcement at all.** That is dev.
- **One `secret` query parameter, or none.** A repeated `?secret=` is a 401 in both languages, never
  resolved to its first value, and a blank repeat (`?secret=<right>&secret=`, either order, or a
  valueless `&secret`) counts as a repeat. Express parses any of them to an array, which the
  `typeof given !== 'string'` guard rejects; Python checks the list length *and* passes
  `keep_blank_values=True`, or `parse_qs` drops the blank half and returns one value that passes.
- **A repeated `X-FastStudy-Secret` is a 401 in both languages too**, in either order. Node folds
  repeats of a header into one comma-joined value that matches nothing; `_header()` joins the ASGI
  scope's repeats with `b", "` for the same result. It folds *every* header, Node's rule, so a
  duplicated `Accept` still selects the `text/event-stream` 401 body.
- **`install_secret_check(app)` must run before `CORSMiddleware` is added.** Starlette makes the
  last-added middleware the outermost, so the secret check sits *inside* CORS — which is what makes
  a 401 carry CORS headers instead of reaching the browser as a network error.
- **`SecretMiddleware` is pure ASGI, never `BaseHTTPMiddleware`** — that one buffers a
  `StreamingResponse` and would stall `/events`.
- **`import runtime` calls `load_dotenv()`.** Every consumer module that reads env at import time
  imports `runtime` first, so this is the one placement that survives an import re-sort.
- **`py-modules = ["runtime"]`** claims exactly the top-level name `runtime`. An editable install
  maps only that declared name, so `tests/` does not leak onto `sys.path` beside it.
- **`state_path` / `statePath` resolve the repo root relative to each file's own location**, so the
  depth is fixed by their position (`<repo>/lib/runtime/py/`, `<repo>/lib/runtime/js/`); moving
  either folder means re-checking it. Both are pure joins that create nothing — importing a module
  that merely names a state file must not leave a directory behind — and a blank
  `FASTSTUDY_STATE_DIR` reads as unset in both.
- **`serve()` starts uvicorn with `log_config=None` (Python).** Otherwise uvicorn's own
  `dictConfig` would replace the access handler [`lib/logging`](../logging/CLAUDE.md) installs, and
  its default would print access lines on *stdout*, the handshake channel. `uvicorn` /
  `uvicorn.error` still propagate to root, so startup, shutdown and ASGI tracebacks stay intact.
- **`peerHeaders` (JS) is for our own services only.** The launch secret must never ride an outbound
  call to an external lecture host.
- **Runtime `dependencies` in `package.json` stay empty.** The module uses `node:` builtins only and
  takes the express app as an argument, so it adds nothing to what the downloader packages install.
  `express` is a *dev*Dependency because `requireSecret` reads `req.path`, `req.query` and
  `req.get()`, which only express defines; `file:` consumers do not install devDependencies.

## Tests

Two suites assert the same auth table in both languages, so a rule that holds in one and not the
other fails here rather than in a service. A change to the table ships with a test pinning it in
both, even where it had no coverage before.

- `py/tests/test_runtime.py` — Starlette's `TestClient`: `uv run --extra test pytest` from `py/`.
- `js/tests/runtime.test.js` — a real express app on a real loopback port: `npm test` from `js/`.
  Over the wire rather than a fake `req`, because the duplicate- and bracketed-query cases are
  assertions about express's own parser.

Both drive `serve()` in a child process, on a free port and an occupied one, since either outcome
ends the process. Both pin the repo root by markers (`package.json` + `CLAUDE.md` beside `.state`)
rather than an absolute path, which is what catches a wrong parent depth after either half moves.
