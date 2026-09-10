"""Shared OAuth helper for Google APIs: the on-disk credential/token files, plus the
non-blocking Drive consent flow the settings screen starts."""

import logging
import threading
import webbrowser
from pathlib import Path
from typing import Literal
from wsgiref.simple_server import WSGIRequestHandler, make_server
from wsgiref.util import request_uri

import runtime
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from services import db_client
from services.resources import resource_path

log = logging.getLogger("google_auth")

# Shipped alongside the code and only ever read, so it stays on the install side of the split.
CREDENTIALS_PATH = str(resource_path("credentials.json"))

SCOPES_MAP = {
    "drive": ["https://www.googleapis.com/auth/drive.file"],
}
ScopeKey = Literal["drive"]

NOT_CONNECTED_MESSAGE = "Google Drive is not connected — connect it in settings"

# How long a started consent flow keeps its loopback listener bound waiting for the redirect.
CONSENT_TIMEOUT_SECONDS = 300

_lock = threading.Lock()
# Set by the first drive step that finds no token, cleared when one lands: a queue of N
# lectures then produces one thing for the UI to render instead of N failures to chase.
_consent_needed = False
# The in-flight consent flow's auth URL, or None. A second connect reuses it rather than
# starting a rival flow whose redirect URI the first one's browser tab would not match.
_pending_url: str | None = None


class DriveNotConnected(RuntimeError):
    """No usable Drive token on disk — the user has to run the consent flow."""


def _token_path(scope_key: ScopeKey) -> Path:
    """Per-scope token file, so different scope sets can't collide. It lives under the state
    root, not beside the code: an update replaces the install dir."""

    return runtime.state_path("auth", f"token_{scope_key}.json")


def _load_token(scope_key: ScopeKey) -> Credentials | None:
    """The stored credentials for one scope set, or None when there are none to use."""

    scopes = SCOPES_MAP[scope_key]
    path = _token_path(scope_key)
    if not path.exists():
        return None
    try:
        # Loaded without the scope list: passing it overwrites the file's own scopes with the
        # ones asked for, which is exactly the mismatch the check below has to catch.
        creds = Credentials.from_authorized_user_file(str(path))
    except ValueError:
        log.warning("%s is unreadable — treating Drive as disconnected", path)
        return None
    # A token cached for a different scope set is silently unusable (opaque 403 later),
    # so treat the mismatch as no token and let the user consent again.
    if set(creds.scopes or []) != set(scopes):
        return None
    return creds


def _write_token(scope_key: ScopeKey, creds: Credentials) -> None:
    path = _token_path(scope_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(creds.to_json())


def _set_consent_needed(value: bool) -> None:
    """Flip the process-level flag, pushing over SSE only when it actually moved — the
    frontend learns without polling, and a queue of failures still notifies once."""

    global _consent_needed
    with _lock:
        if _consent_needed == value:
            return
        _consent_needed = value
    db_client.notify()


def get_credentials(scope_key: ScopeKey) -> Credentials:
    """Load the stored credentials for one scope set, refreshing an expired token. Never
    interactive: with no usable token it raises DriveNotConnected instead of blocking."""

    if scope_key not in SCOPES_MAP:
        raise ValueError(f"Unknown scope key: {scope_key}")

    creds = _load_token(scope_key)
    if creds and not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                _write_token(scope_key, creds)
            except Exception as e:
                log.warning("Drive token refresh failed: %s", e)
                creds = None
        else:
            creds = None

    if not creds:
        _set_consent_needed(True)
        raise DriveNotConnected(NOT_CONNECTED_MESSAGE)
    _set_consent_needed(False)
    return creds


# ---- Consent ----


# The page Google's redirect lands on; the consent flow's only user-visible HTML.
_DONE_PAGE = (
    "<!doctype html><meta charset='utf-8'><title>FastStudy</title>"
    "<body style='font-family:sans-serif;text-align:center;padding-top:4rem'>"
    "<h2>FastStudy</h2><p>Consent received — you can close this tab.</p>"
).encode("utf-8")


class _RedirectApp:
    """WSGI app for the one request the consent flow expects: it keeps the redirect's full
    URL, code and all, and answers with a page telling the user to close the tab — it runs
    before the token exchange, so that page can never claim success."""

    def __init__(self):
        self.request_uri: str | None = None

    def __call__(self, environ, start_response):
        start_response("200 OK", [("Content-Type", "text/html; charset=utf-8")])
        self.request_uri = request_uri(environ)
        return [_DONE_PAGE]


class _QuietHandler(WSGIRequestHandler):
    """The stock handler writes a request line to stderr; the consent redirect needs no log."""

    def log_message(self, format, *args):
        pass


def start_consent() -> str:
    """Start the Drive consent flow and return its URL, without waiting for the user. The
    browser is opened here too, so the URL is the UI's 'didn't open?' fallback."""

    global _pending_url
    with _lock:
        if _pending_url:
            return _pending_url

        if not Path(CREDENTIALS_PATH).exists():
            raise RuntimeError(
                f"Google credentials file not found at {CREDENTIALS_PATH}. "
                "Download credentials.json from Google Cloud Console and place it there."
            )

        flow = InstalledAppFlow.from_client_secrets_file(
            CREDENTIALS_PATH, SCOPES_MAP["drive"]
        )
        # run_local_server() cannot hand back the URL before it blocks, so the listener it
        # would create is built here and waited on off the request thread.
        redirect_app = _RedirectApp()
        server = make_server("localhost", 0, redirect_app, handler_class=_QuietHandler)
        server.timeout = CONSENT_TIMEOUT_SECONDS
        flow.redirect_uri = f"http://localhost:{server.server_port}/"
        # offline+consent: a refresh token is only issued on an explicit consent screen, and
        # without one every expiry would need the user again.
        auth_url, _ = flow.authorization_url(access_type="offline", prompt="consent")
        _pending_url = auth_url

        threading.Thread(
            target=_await_consent, args=(flow, server, redirect_app), daemon=True
        ).start()
        # Its own thread: with only a console browser installed, webbrowser.open blocks
        # until that browser exits. Never printed to stdout — the launcher parses stdout.
        threading.Thread(target=webbrowser.open, args=(auth_url,), daemon=True).start()
        return auth_url


def _await_consent(flow, server, redirect_app: _RedirectApp) -> None:
    """Wait for Google's redirect, exchange the code and store the token. Runs on a daemon
    thread; a user who never consents is dropped after CONSENT_TIMEOUT_SECONDS."""

    global _pending_url
    try:
        server.handle_request()  # returns on the redirect, or on the timeout with nothing
        if not redirect_app.request_uri:
            log.warning("Drive consent timed out with no redirect")
            return
        # oauthlib refuses a plain-http authorization response, so the loopback URL is
        # relabelled https for the exchange alone — what run_local_server does too.
        flow.fetch_token(
            authorization_response=redirect_app.request_uri.replace(
                "http://", "https://", 1
            )
        )
        _write_token("drive", flow.credentials)
        _set_consent_needed(False)
    except Exception:
        log.exception("Drive consent failed")
    finally:
        server.server_close()
        with _lock:
            _pending_url = None
        db_client.notify()


def disconnect() -> None:
    """Forget the Drive token. Already gone counts as success — the end state is what matters."""

    _token_path("drive").unlink(missing_ok=True)
    db_client.notify()


def drive_status() -> dict:
    """What the settings screen renders: whether a token is stored, whether a consent flow
    is waiting on the user, and whether a pipeline step gave up for want of a token."""

    return {
        "connected": _load_token("drive") is not None,
        "pending": _pending_url is not None,
        "consent_needed": _consent_needed,
    }
