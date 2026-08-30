from unittest.mock import MagicMock, patch

import pytest
import requests
from services import providers


class TestPublicProviders:
    def test_carries_the_id_and_hides_the_probe_url(self):
        rows = providers.public_providers()
        assert {row["id"] for row in rows} == set(providers.PROVIDERS)
        for row in rows:
            assert set(row) == {"id", "display_name", "key_prefix", "console_url"}

    def test_every_row_is_complete(self):
        for row in providers.PROVIDERS.values():
            assert all(row.values())


def _probe(provider="groq", *, status=None, error=None):
    """Run probe_key against a faked requests.get, returning its verdict."""

    get = MagicMock(
        side_effect=error, return_value=MagicMock(status_code=status or 200)
    )
    with patch.object(providers.requests, "get", get):
        return providers.probe_key(provider, "secret-key"), get


class TestProbeKey:
    @pytest.mark.parametrize("status", [200, 204])
    def test_2xx_is_valid(self, status):
        assert _probe(status=status)[0] == "valid"

    @pytest.mark.parametrize("status", [401, 403])
    def test_401_403_is_rejected(self, status):
        assert _probe(status=status)[0] == "rejected"

    @pytest.mark.parametrize("status", [404, 429, 500, 503])
    def test_any_other_status_is_unverified(self, status):
        """A provider outage or a moved endpoint must never read as a bad key."""

        assert _probe(status=status)[0] == "unverified"

    @pytest.mark.parametrize("error", [requests.Timeout(), requests.ConnectionError()])
    def test_network_failure_is_unverified(self, error):
        assert _probe(error=error)[0] == "unverified"

    def test_sends_each_provider_its_own_auth_header(self):
        _, groq_get = _probe("groq")
        assert groq_get.call_args.args[0] == providers.PROVIDERS["groq"]["probe_url"]
        assert groq_get.call_args.kwargs["headers"] == {
            "Authorization": "Bearer secret-key"
        }
        assert groq_get.call_args.kwargs["timeout"] == providers.PROBE_TIMEOUT_SECONDS

        _, gemini_get = _probe("gemini")
        assert gemini_get.call_args.kwargs["headers"] == {
            "x-goog-api-key": "secret-key"
        }

    def test_the_key_never_reaches_a_log_line(self, caplog):
        with caplog.at_level("DEBUG"):
            _probe(status=500)
            _probe(error=requests.ConnectionError("failed for url https://x"))
        assert "secret-key" not in caplog.text
