# lib/sentry

Sentry _policy_, in both languages, importing no Sentry SDK: each runtime passes these into its own
SDK's init, so what gets scrubbed and how events are labelled cannot drift. `py/sentry_policy.py`
serves `backend/` and `database/`; `js/sentry.js` (with a hand-written `sentry.d.ts`) serves
`downloader/server`, `downloader/auto`, `electron/` main and the `frontend/` renderer — the first
consumer outside a service directory, and a browser bundle, so the JS half has no `node:` import
and guards every `process` read.

## Exports (snake_case in py, camelCase in js)

- `scrub(event, hint)` — `before_send`. Every string in the event (message, exception values, frame
  paths, `vars`, context lines, breadcrumbs, `extra`, `contexts`, request URL and headers) loses:
  anything under `DATA_ROOT` → `<data>`; Hebrew runs, literal or percent/`\u`/`\x`-escaped →
  `<hebrew>`; the real home → `<home>`, and any `C:\Users\<name>`, `/home/<name>`, `/Users/<name>`
  → `<user>` (prefix kept — the renderer knows no home); `GROQ_API_KEY`, `GEMINI_API_KEY` and
  `FASTSTUDY_SECRET` values, `gsk_…`/`AIza…` shapes and `secret=` query values → `<key>`.
  `server_name` (the hostname) and `user` are deleted.
- `scrub_breadcrumb` / `scrubBreadcrumb` — `before_breadcrumb`, the same walk on one crumb.
- `tags(service)` — `{service, platform}`; `service` is one of `backend database server auto electron
frontend`, anything else throws. `platform` is `win32`/`linux`/`darwin` in both languages.
- `enabled(dsn?)` — false with no DSN; the caller then skips init entirely.
- `options(service, …)` — what init spreads: `dsn` (`FASTSTUDY_SENTRY_DSN`), `release`
  `faststudy@<FASTSTUDY_VERSION>`, `environment` (`production` iff `FASTSTUDY_SECRET` is set),
  sample rate 1, no default PII, both scrubbers. The traces rate is left unset, not `0`: `0` still
  switches tracing on and propagates trace headers onto cross-origin calls to the services. `dsn`,
  `version` and `environment` can be passed explicitly — the renderer bakes `VITE_SENTRY_DSN`, electron main passes `app.getVersion()`.
  JS adds `initialScope: {tags}`; Python's `init` has no such option, so call
  `sentry_sdk.set_tags(tags(service))` after it.

## Rules

- **A scrub failure drops the event** (returns `None`/`null`): an unscrubbed event is the leak this
  exists to prevent, a lost one is not.
- **Env is read per call**, not at import, so a `DATA_ROOT` or key changed in Settings is scrubbed
  from the next event on. A value only in `.env` and never in `os.environ` is not seen; the
  shape-based rules (Hebrew, home, key patterns) still cover it.
- **No fallback DSN anywhere.** Dev has none, so dev sends nothing; packaged, the launcher sets it.
  That is the claim on both run paths.
- Sentry's free tier keeps events 30 days — an issue older than that is gone, not fixed.

Tests: `cd py && uv run --extra test pytest` and `cd js && npm test`. A change to one half is a
change to both, tests included.
