import json
from datetime import datetime, timedelta, timezone

import pytest
from google.oauth2.credentials import Credentials
from services import google_auth

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"


def _token_file(
    scopes=(DRIVE_SCOPE,), token="access-token", expires_in=timedelta(hours=1)
):
    # An authorized-user file with no `expiry` reads back as expired, so every one carries it.
    expiry = datetime.now(timezone.utc).replace(tzinfo=None) + expires_in
    body = {
        "client_id": "cid.apps.googleusercontent.com",
        "client_secret": "secret",
        "refresh_token": "refresh-token",
        "token": token,
        "scopes": list(scopes),
        "expiry": expiry.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    path = google_auth._token_path("drive")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body))
    return path


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    # The token lives under the state root, and the flag/pending pair is process-global.
    monkeypatch.setenv("FASTSTUDY_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setattr(google_auth, "_consent_needed", False)
    monkeypatch.setattr(google_auth, "_pending_url", None)
    monkeypatch.setattr(google_auth.db_client, "notify", lambda: None)


class TestGetCredentials:
    def test_no_token_raises_rather_than_prompting(self):
        with pytest.raises(google_auth.DriveNotConnected):
            google_auth.get_credentials("drive")

    def test_a_token_for_other_scopes_is_not_usable(self):
        _token_file(scopes=("https://www.googleapis.com/auth/gmail.readonly",))
        with pytest.raises(google_auth.DriveNotConnected):
            google_auth.get_credentials("drive")

    def test_unreadable_token_is_treated_as_disconnected(self):
        path = google_auth._token_path("drive")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json")
        with pytest.raises(google_auth.DriveNotConnected):
            google_auth.get_credentials("drive")

    def test_a_stored_token_is_returned(self):
        _token_file()
        creds = google_auth.get_credentials("drive")
        assert creds.token == "access-token"

    def test_an_expired_token_is_refreshed_and_written_back(self, monkeypatch):
        _token_file(expires_in=-timedelta(hours=1))

        def fake_refresh(self, request):
            self.token = "fresh-token"
            self.expiry = None

        monkeypatch.setattr(Credentials, "refresh", fake_refresh)
        creds = google_auth.get_credentials("drive")
        assert creds.token == "fresh-token"
        stored = json.loads(google_auth._token_path("drive").read_text())
        assert stored["token"] == "fresh-token"

    def test_a_failed_refresh_reports_not_connected(self, monkeypatch):
        _token_file(expires_in=-timedelta(hours=1))

        def boom(self, request):
            raise RuntimeError("invalid_grant")

        monkeypatch.setattr(Credentials, "refresh", boom)
        with pytest.raises(google_auth.DriveNotConnected):
            google_auth.get_credentials("drive")

    def test_unknown_scope_key(self):
        with pytest.raises(ValueError):
            google_auth.get_credentials("gmail")


class TestConsentNeededFlag:
    def test_a_missing_token_sets_it_and_notifies_once(self, monkeypatch):
        calls = []
        monkeypatch.setattr(google_auth.db_client, "notify", lambda: calls.append(1))

        for _ in range(3):
            with pytest.raises(google_auth.DriveNotConnected):
                google_auth.get_credentials("drive")

        # N lectures with no token are one state change, so the frontend hears once.
        assert google_auth.drive_status()["consent_needed"] is True
        assert len(calls) == 1

    def test_a_landed_token_clears_it(self):
        with pytest.raises(google_auth.DriveNotConnected):
            google_auth.get_credentials("drive")
        _token_file()
        google_auth.get_credentials("drive")
        assert google_auth.drive_status()["consent_needed"] is False


class TestDisconnect:
    def test_deletes_the_token(self):
        path = _token_file()
        google_auth.disconnect()
        assert not path.exists()
        assert google_auth.drive_status()["connected"] is False

    def test_already_disconnected_is_success(self):
        google_auth.disconnect()


class TestStartConsent:
    @pytest.fixture(autouse=True)
    def _client_secrets(self, tmp_path, monkeypatch):
        secrets = tmp_path / "credentials.json"
        secrets.write_text(
            json.dumps(
                {
                    "installed": {
                        "client_id": "cid.apps.googleusercontent.com",
                        "client_secret": "secret",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                    }
                }
            )
        )
        monkeypatch.setattr(google_auth, "CREDENTIALS_PATH", str(secrets))
        monkeypatch.setattr(google_auth.webbrowser, "open", lambda url: True)
        # Keeps the waiting thread's loopback listener from lingering for five minutes.
        monkeypatch.setattr(google_auth, "CONSENT_TIMEOUT_SECONDS", 2)

    def test_returns_a_consent_url_without_blocking(self):
        url = google_auth.start_consent()
        assert url.startswith("https://accounts.google.com/o/oauth2/auth?")
        assert "access_type=offline" in url and "prompt=consent" in url
        # The redirect goes to the loopback listener this call bound.
        assert "redirect_uri=http%3A%2F%2Flocalhost%3A" in url
        assert google_auth.drive_status()["pending"] is True

    def test_a_second_connect_reuses_the_pending_flow(self):
        first = google_auth.start_consent()
        assert google_auth.start_consent() == first

    def test_missing_client_secrets_is_an_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            google_auth, "CREDENTIALS_PATH", str(tmp_path / "gone.json")
        )
        with pytest.raises(RuntimeError):
            google_auth.start_consent()
