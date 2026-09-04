"""Shared OAuth helper for Google APIs, so the on-disk credential/token files live in one place."""

from pathlib import Path
from typing import Literal

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

import runtime

# Shipped alongside the code and only ever read, so it stays on the install side of the split.
CREDENTIALS_PATH = str(Path(__file__).parent.parent / "credentials.json")

SCOPES_MAP = {
    "drive": ["https://www.googleapis.com/auth/drive.file"],
}
ScopeKey = Literal["drive"]


def get_credentials(scope_key: ScopeKey) -> Credentials:
    """Load (or interactively obtain) credentials for one scope set, caching per scope key."""

    scopes = SCOPES_MAP.get(scope_key)
    if not scopes:
        raise ValueError(f"Unknown scope key: {scope_key}")

    if not Path(CREDENTIALS_PATH).exists():
        raise RuntimeError(
            f"Google credentials file not found at {CREDENTIALS_PATH}. "
            "Download credentials.json from Google Cloud Console and place it there."
        )

    # Per-scope token file, so different scope sets can't collide. It lives under the state
    # root, not beside the code: an update replaces the install dir, and a wiped token costs
    # the user a fresh consent flow.
    token_path = runtime.state_path("auth", f"token_{scope_key}.json")

    creds: Credentials | None = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), scopes)

    # A token cached for a different scope set is silently unusable (opaque 403 later),
    # so detect the mismatch up front and force a fresh consent flow.
    if creds and set(creds.scopes or []) != set(scopes):
        creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, scopes)
            creds = flow.run_local_server(port=0, open_browser=False)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json())

    return creds
