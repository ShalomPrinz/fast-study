"""Shared OAuth helper for Google APIs. The Drive uploader obtains `Credentials`
through here so the on-disk credential/token files live in one place.
"""

from pathlib import Path
from typing import Literal

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

CREDENTIALS_PATH = str(Path(__file__).parent.parent / "credentials.json")

SCOPES_MAP = {
    "drive": ["https://www.googleapis.com/auth/drive.file"],
}
ScopeKey = Literal["drive"]

def get_credentials(scope_key: ScopeKey) -> Credentials:
    scopes = SCOPES_MAP.get(scope_key)
    if not scopes:
        raise ValueError(f"Unknown scope key: {scope_key}")

    if not Path(CREDENTIALS_PATH).exists():
        raise RuntimeError(
            f"Google credentials file not found at {CREDENTIALS_PATH}. "
            "Download credentials.json from Google Cloud Console and place it there."
        )

    # Per-scope token file to prevent token collision due to different scopes
    token_path = str(Path(__file__).parent.parent / f"token_{scope_key}.json")

    creds: Credentials | None = None
    if Path(token_path).exists():
        creds = Credentials.from_authorized_user_file(token_path, scopes)

    # A cached token issued for a different scope set is silently unusable —
    # the API call later fails with an opaque 403. Detect the mismatch up front
    # and force a fresh consent flow.
    if creds and set(creds.scopes or []) != set(scopes):
        creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, scopes)
            creds = flow.run_local_server(port=0, open_browser=False)
        Path(token_path).write_text(creds.to_json())

    return creds
