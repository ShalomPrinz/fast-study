# SETTINGS — the settings store

The one thing this service writes **outside `DATA_ROOT`**: the repo-root `.env`, backing the app's
settings surface in browser dev. `settings.py` resolves it from the module's own location, never
from the cwd — each service runs with its own directory as cwd.

Under Electron the same fields live in `%APPDATA%` (the API keys in a `safeStorage` blob beside
it), so the two backings must agree on shape. The field names below are the wire contract: they
match `backend/services/settings.py` and the frontend's `WIRE` map in
`frontend/src/services/settings.ts`, and any future Electron backing joins that agreement.

## Fields

`GET /settings` answers with every field, `null` for any key absent from `.env` — the client
applies its own defaults, and an absent value has to stay distinguishable from a stored one.

| Field                                             | `.env` key                                        |
| ------------------------------------------------- | ------------------------------------------------- |
| `data_root`                                        | `DATA_ROOT`                                       |
| `gemini_api_key_set` / `groq_api_key_set` (bool)   | `GEMINI_API_KEY` / `GROQ_API_KEY`                 |
| `gemini_model`                                     | `GEMINI_MODEL`                                    |
| `drive_enabled`, `gdrive_root_folder`              | `DRIVE_ENABLED`, `GDRIVE_ROOT_FOLDER`             |
| `auto_run`                                         | `AUTO_RUN`                                        |

The two API keys are **write-only**: `PUT` accepts `gemini_api_key` / `groq_api_key`, and the read
path reports only whether each is set, so a stored key never travels back to the client — the same
rule `safeStorage` follows under Electron.

The list is closed to **credentials, `DATA_ROOT`, and the backend's own pipeline config** — nothing
else. A purely visual preference (the UI language, the sidebar's lectures/courses mode) is the browser
profile's, kept in its `localStorage`, and `PUT` rejects it as an unknown setting: routing it through
a file every service reads would make one machine's cosmetics everyone's configuration.

## Merge, never rewrite

`PUT /settings` takes a partial object of the same fields. **Only the named keys are touched**, so
ports, `DOWNLOADER_EXTENSION_ID`, `FRONTEND_URL`, comments, blank lines, ordering and every unknown
key survive. New keys append at the end. An omitted field — and a `null`, so echoing a read back
blanks nothing — is left alone; `""` clears.

Values are written single-quoted, which `.env` parsers read literally, so Windows backslashes
survive; a value containing a single quote or a line break is refused, because that quoting cannot
represent one.

## `DATA_ROOT` validation

Validated before it is stored, by `PUT /settings` and `POST /config` alike: it must be absolute (a
relative root would resolve against each service's own cwd), it is created if missing, and a probe
file is written and deleted to prove the location is writable — otherwise an unwritable root
surfaces as a pipeline failure minutes later.

## No restart

`POST /config` applies `{data_root}` to `os.environ`. Nothing has to restart because `fs/paths.py`'s
`data_root()` re-reads the environment on every call; `main.py`'s module-level `DATA_ROOT` is a
boot-time fail-fast that nothing reads.

Changing the root **re-points only and never moves data**, so a change mid-run splits a lecture
across two roots. The guard for that is advisory and lives in the frontend, which knows what is in
flight; there is deliberately no 409 here.
