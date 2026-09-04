# lib/runtime

The packaged launch contract, in both languages. `runtime.py` serves `backend/` and `database/`;
`runtime.js` serves `downloader/server` and `downloader/auto`. The frontend's own
`src/services/runtime.ts` is a different thing — a browser-side reader of the preload bridge, with
no server to bind and no secret to enforce — and is deliberately not here.

## The two halves implement the same two contracts

They are separate files that agree on a contract, so **a change to one is a change to both**.

**The launcher handshake.** `serve()` binds `127.0.0.1` (never a public interface), then prints
exactly `FASTSTUDY_PORT=<port>` alone on a line, which the launcher matches as `^FASTSTUDY_PORT=(\d+)$`.
The socket is bound by hand on the Python side because `uvicorn.run(port=0)` never reports what it
resolved to. The announcement comes *after* `listen()` so a launcher connecting on the instant it
reads the line is not refused.

**The launch-secret check.** Every request must carry `$FASTSTUDY_SECRET` as an `X-FastStudy-Secret`
header **or** a `secret` query parameter. The query parameter exists solely because native
`EventSource` cannot set a header; the two are tried independently, never `header or param`, so a
wrong or blank header cannot shadow the only credential an SSE caller can send. A 401 on a request
that asked for `text/event-stream` must answer with that same MIME — Chromium reports any other MIME
on an `EventSource` as a bare transport error, hiding the auth failure behind what looks like a
dropped connection. Comparison is constant-time on both sides (`compare_digest` / `timingSafeEqual`);
the JS side checks length first because `timingSafeEqual` throws on unequal buffers, and the length
is fixed by the launcher and not itself a secret.

## Nuances

- **`GET /health` is the only exemption**, and it is exempt so the launcher's boot screen can tell a
  wrong secret from a dead child. GET only: nothing else bypasses the check.
- **An unset `FASTSTUDY_SECRET` installs no enforcement at all.** That is dev.
- **`install_secret_check(app)` must run before `CORSMiddleware` is added.** Starlette makes the
  last-added middleware the outermost, so adding the secret check first leaves it *inside* CORS —
  which is what makes a 401 carry CORS headers instead of reaching the browser as a network error.
- **`SecretMiddleware` is pure ASGI, never `BaseHTTPMiddleware`** — that one buffers a
  `StreamingResponse` and would stall `/events`.
- **`py-modules = ["runtime"]`** claims exactly the top-level name `runtime`. An editable install
  maps only that declared name, so `runtime.js`, `package.json` and `tests/` do not leak onto
  `sys.path` despite sharing the directory.
- **`state_path` / `statePath` resolve the repo root relative to this file's own location**, and that
  depth is fixed by this folder's position (`<repo>/lib/runtime/`). Moving the folder breaks both and
  the depths must be re-checked. Both are pure joins that create nothing: importing a module that
  merely names a state file must not leave a directory behind.
- **`peerHeaders` (JS) is for our own services only.** The launch secret must never ride an outbound
  call to an external lecture host.
- **Runtime `dependencies` in `package.json` stay empty.** The module uses `node:crypto`, `node:path`
  and `node:url` only, and takes the express app as an argument rather than importing express, so it
  adds nothing to what the two downloader packages install. `express` is a *dev*Dependency because
  `requireSecret` reads `req.path`, `req.query` and `req.get()` — which only express defines — so its
  tests need a real express request to drive. `file:` consumers do not install devDependencies.

## Tests

`tests/test_runtime.py` covers the auth table through Starlette's `TestClient`:
`uv run --extra test pytest` from this folder.
