"""The offline shim every Python service is started with, attached through PYTHONPATH.

It rewrites the two provider base URLs onto the fake provider server, fakes Google Drive,
repoints the settings store at a scratch .env, and refuses any connection off loopback. Nothing
here edits production code: each patch is applied to a module right after it is imported.
"""

import importlib.util
import json
import os
import re
import socket
import sys
import threading
from importlib.abc import MetaPathFinder
from pathlib import Path

_HARNESS = os.environ.get("HUNT_BUGS_HARNESS")

# Inert without the variable, so a stray `uv run` that happens to inherit PYTHONPATH is not
# crippled by a half-applied harness. The self-checks prove the shim IS live in the services.
if _HARNESS:
    HARNESS = Path(_HARNESS)
    PROVIDERS = os.environ.get("HUNT_BUGS_PROVIDERS", "http://127.0.0.1:4598")

    class HarnessEscape(RuntimeError):
        """A request tried to leave loopback. Raised, never logged away — an escaped call means
        the run touched a real service and every finding after it is suspect."""

    _LOCAL = {"localhost", "0.0.0.0", "::1", "::", ""}

    def _is_local(host) -> bool:
        if host is None:
            return True
        name = str(host)
        return name in _LOCAL or name.startswith("127.")

    def _note(line):
        """One line in network.log, in the Node shim's format, so `hb refused` sees both languages."""

        from datetime import datetime, timezone

        stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        service = os.environ.get("HUNT_BUGS_SERVICE", "python")
        try:
            log = HARNESS / "logs" / "network.log"
            log.parent.mkdir(parents=True, exist_ok=True)
            with open(log, "a", encoding="utf-8") as handle:
                handle.write(f"{stamp.replace('+00:00', 'Z')} {service} {line}\n")
        except OSError:
            pass

    def _refuse(host, port):
        _note(f"REFUSED {host}:{port}")
        raise HarnessEscape(
            f"hunt-bugs harness is offline — refused a connection to {host}:{port}. "
            "A provider or Google call that is not going through the fakes is a harness bug."
        )

    _getaddrinfo = socket.getaddrinfo

    def _guarded_getaddrinfo(host, port, *args, **kwargs):
        if not _is_local(host):
            _refuse(host, port)
        return _getaddrinfo(host, port, *args, **kwargs)

    socket.getaddrinfo = _guarded_getaddrinfo

    _connect = socket.socket.connect

    def _guarded_connect(self, address):
        if isinstance(address, tuple) and not _is_local(address[0]):
            _refuse(address[0], address[1] if len(address) > 1 else "?")
        return _connect(self, address)

    socket.socket.connect = _guarded_connect

    # ---- the patches, one per module ----

    def _patch_providers(module):
        """Both SDKs read their base URL from this table, which is why faking here needs no
        production hook: the clients, their retries and their error parsing stay real."""

        module.PROVIDERS["groq"]["base_url"] = f"{PROVIDERS}/groq"
        module.PROVIDERS["gemini"]["base_url"] = f"{PROVIDERS}/gemini/"

    def _patch_runtime(module):
        """`runtime` calls load_dotenv() at import, so this is the first moment the race with the
        repo-root .env is decided. A real key winning it would make the whole run unsafe."""

        problems = []
        for name, expected in (
            ("GROQ_API_KEY", "gsk_huntbugs"),
            ("GEMINI_API_KEY", "AIzaHuntBugs"),
        ):
            if not os.environ.get(name, "").startswith(expected):
                problems.append(
                    f"{name} is not the harness key — the repo .env won the race"
                )
        data_root = os.environ.get("DATA_ROOT", "")
        if not data_root.startswith(str(HARNESS)):
            problems.append(f"DATA_ROOT is {data_root!r}, outside the harness")
        if problems:
            for problem in problems:
                print(f"hunt-bugs shim: {problem}", file=sys.stderr, flush=True)
            os._exit(3)
        print(
            f"hunt-bugs shim: live (keys {os.environ['GROQ_API_KEY'][:12]}…/"
            f"{os.environ['GEMINI_API_KEY'][:12]}…, data {data_root})",
            file=sys.stderr,
            flush=True,
        )

    def _patch_settings(module):
        """The database service's settings store rewrites this file on every save — pointed at a
        scratch copy so driving the settings screen can never touch the real .env."""

        if hasattr(module, "ENV_PATH"):
            module.ENV_PATH = HARNESS / ".env"

    def _patch_google_auth(module):
        """Consent needs a Google account and a browser, so the flow is faked end to end — but
        through the same pending → connected states the settings screen renders."""

        token_file = HARNESS / "drive" / "token.json"

        class _FakeCredentials:
            valid = True
            expired = False
            token = "hunt-bugs-fake-token"

        def _load_token(scope_key):
            return _FakeCredentials() if token_file.exists() else None

        def get_credentials(scope_key):
            if scope_key not in module.SCOPES_MAP:
                raise ValueError(f"Unknown scope key: {scope_key}")
            if not token_file.exists():
                module._set_consent_needed(True)
                raise module.DriveNotConnected(module.NOT_CONNECTED_MESSAGE)
            module._set_consent_needed(False)
            return _FakeCredentials()

        def _finish(url):
            token_file.parent.mkdir(parents=True, exist_ok=True)
            token_file.write_text(json.dumps({"fake": True}), encoding="utf-8")
            module._set_consent_needed(False)
            with module._lock:
                if module._pending_url == url:
                    module._pending_url = None
            module.db_client.notify()

        def start_consent():
            """Stays pending for a moment, so the settings screen's pending state is real."""

            url = f"{PROVIDERS}/drive/consent"
            with module._lock:
                if module._pending_url:
                    return module._pending_url
                module._pending_url = url
            threading.Timer(1.5, _finish, args=(url,)).start()
            return url

        def disconnect():
            token_file.unlink(missing_ok=True)
            module.db_client.notify()

        module._load_token = _load_token
        module.get_credentials = get_credentials
        module.start_consent = start_consent
        module.disconnect = disconnect

    def _patch_discovery(module):
        """Drive uploads land in a JSON store under the harness, so upload_to_drive keeps its real
        branching (find folder, create folder, create vs update file) with nothing to sign in to."""

        store_dir = HARNESS / "drive"
        store_path = store_dir / "store.json"
        ops_path = store_dir / "ops.jsonl"

        def _load():
            try:
                return json.loads(store_path.read_text(encoding="utf-8"))
            except Exception:
                return {"next_id": 1, "files": {}}

        def _save(store):
            store_dir.mkdir(parents=True, exist_ok=True)
            store_path.write_text(
                json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8"
            )

        def _record(op, detail):
            store_dir.mkdir(parents=True, exist_ok=True)
            with open(ops_path, "a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps({"op": op, **detail}, ensure_ascii=False) + "\n"
                )

        FOLDER = "application/vnd.google-apps.folder"

        class _Request:
            def __init__(self, result):
                self._result = result

            def execute(self):
                return self._result

        class _Files:
            def list(self, q=None, fields=None, pageSize=None, **kwargs):
                name = re.search(r"name='((?:[^']|\\')*)'", q or "")
                parent = re.search(r"'([^']+)' in parents", q or "")
                wants_folder = f"mimeType='{FOLDER}'" in (q or "")
                store = _load()
                target = name.group(1).replace("\\'", "'") if name else None
                parent_id = parent.group(1) if parent else None
                hits = [
                    {"id": fid}
                    for fid, row in store["files"].items()
                    if row["name"] == target
                    and row["parent"] == parent_id
                    and (row["mimeType"] == FOLDER) == wants_folder
                ]
                return _Request({"files": hits[:1]})

            def create(self, body=None, media_body=None, fields=None, **kwargs):
                store = _load()
                file_id = f"hunt-{store['next_id']}"
                store["next_id"] += 1
                store["files"][file_id] = {
                    "name": body["name"],
                    "parent": (body.get("parents") or [None])[0],
                    "mimeType": body.get("mimeType", "application/pdf"),
                }
                _save(store)
                _record("create", {"id": file_id, **store["files"][file_id]})
                self._keep(file_id, media_body)
                return _Request(
                    {
                        "id": file_id,
                        "webViewLink": f"https://drive.fake/hunt-bugs/{file_id}",
                    }
                )

            def update(self, fileId=None, media_body=None, fields=None, **kwargs):
                _record("update", {"id": fileId})
                self._keep(fileId, media_body)
                return _Request(
                    {
                        "id": fileId,
                        "webViewLink": f"https://drive.fake/hunt-bugs/{fileId}",
                    }
                )

            def _keep(self, file_id, media_body):
                """Copy the uploaded bytes, so a finding can point at what actually went up."""

                source = getattr(media_body, "_filename", None)
                if not source:
                    return
                dest = store_dir / "files" / f"{file_id}.pdf"
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(Path(source).read_bytes())

        class _Service:
            def files(self):
                return _Files()

        module.build = lambda *args, **kwargs: _Service()

    # The lecture the current thread works for, as its path under DATA_ROOT; the fake providers
    # target a failure at it, since nothing the SDKs send names the lecture.
    _target = threading.local()

    def _targeting(fn, path_of):
        def wrapped(*args, **kwargs):
            _target.path = path_of(*args)
            try:
                return fn(*args, **kwargs)
            finally:
                _target.path = None

        return wrapped

    def _patch_pipeline_runner(module):
        """Each step runs in its own worker thread, so the thread names the lecture its calls are for."""

        def path_of(course, lecture, kind):
            return (
                f"{course}/Recitations/{lecture}"
                if kind == "recitation"
                else f"{course}/{lecture}"
            )

        for step, fn in module._EXECUTORS.items():
            module._EXECUTORS[step] = _targeting(fn, path_of)

    def _patch_course_analyze(module):
        module.run_analyze = _targeting(module.run_analyze, lambda course, *_: course)

    def _patch_httpx(module):
        """Both SDKs send through httpx.Client, so this one hook stamps every provider call."""

        from urllib.parse import quote

        send = module.Client.send

        def stamped(self, request, *args, **kwargs):
            path = getattr(_target, "path", None)
            if path:
                request.headers["x-hunt-bugs-lecture"] = quote(path, safe="/")
            return send(self, request, *args, **kwargs)

        module.Client.send = stamped

    def _patch_locks(module):
        """Windows refuses to write, delete or rename a file a viewer holds open; Linux never does.
        Paths matching a glob in locks.json (`hb lock`) fail the way Windows reports it."""

        import builtins
        import errno
        import io
        from fnmatch import fnmatchcase

        locks_file = HARNESS / "locks.json"

        def _locked(path):
            try:
                patterns = json.loads(_open(locks_file, encoding="utf-8").read())
            except (OSError, ValueError):
                return False
            text = os.fspath(path) if isinstance(path, (str, os.PathLike)) else ""
            return any(fnmatchcase(text, f"*/{pattern}") for pattern in patterns)

        def _violation(path):
            # ERROR_SHARING_VIOLATION: what os.unlink/open report on Windows, winerror and all.
            error = PermissionError(
                errno.EACCES,
                "The process cannot access the file because it is being used by another process",
                os.fspath(path),
            )
            error.winerror = 32
            return error

        _open, _unlink, _rename, _replace = io.open, os.unlink, os.rename, os.replace

        def guarded_open(file, mode="r", *args, **kwargs):
            if any(flag in mode for flag in "wax+") and _locked(file):
                raise _violation(file)
            return _open(file, mode, *args, **kwargs)

        def guarded_unlink(path, *args, **kwargs):
            if _locked(path):
                raise _violation(path)
            return _unlink(path, *args, **kwargs)

        def guarded_move(original):
            def move(src, dst, *args, **kwargs):
                for path in (src, dst):
                    if _locked(path):
                        raise _violation(path)
                return original(src, dst, *args, **kwargs)

            return move

        io.open = builtins.open = guarded_open
        os.unlink = os.remove = guarded_unlink
        os.rename, os.replace = guarded_move(_rename), guarded_move(_replace)

    _PATCHES = {
        "fs.paths": _patch_locks,
        "runtime": _patch_runtime,
        "services.providers": _patch_providers,
        "services.google_auth": _patch_google_auth,
        "settings": _patch_settings,
        "googleapiclient.discovery": _patch_discovery,
        "pipeline.runner": _patch_pipeline_runner,
        "course.analyze": _patch_course_analyze,
        "httpx": _patch_httpx,
    }

    class _PatchAfterImport(MetaPathFinder):
        """Wrap a module's loader so the patch runs right after the real module executes."""

        def __init__(self):
            self._busy = set()

        def find_spec(self, fullname, path=None, target=None):
            patch = _PATCHES.get(fullname)
            if patch is None or fullname in self._busy:
                return None
            self._busy.add(fullname)
            try:
                spec = importlib.util.find_spec(fullname)
            except Exception:
                return None
            finally:
                self._busy.discard(fullname)
            if spec is None or spec.loader is None:
                return None
            original = spec.loader.exec_module

            def exec_module(module, _original=original, _patch=patch):
                _original(module)
                _patch(module)

            spec.loader.exec_module = exec_module
            return spec

    sys.meta_path.insert(0, _PatchAfterImport())
