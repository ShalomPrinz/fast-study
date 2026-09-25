from unittest.mock import MagicMock, patch

import pytest
import requests
from services import providers


class TestPublicProviders:
    def test_carries_the_id_and_hides_the_base_url_and_probe(self):
        rows = providers.public_providers()
        assert {row["id"] for row in rows} == set(providers.PROVIDERS)
        for row in rows:
            assert set(row) == {"id", "display_name", "key_prefix", "console_url"}

    def test_base_url_is_each_sdks_own_default(self):
        assert providers.base_url("groq") == "https://api.groq.com"
        assert (
            providers.base_url("gemini") == "https://generativelanguage.googleapis.com/"
        )

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
        assert groq_get.call_args.args[0] == "https://api.groq.com/openai/v1/models"
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


def _gemini_400(reason: str) -> dict:
    """A trimmed copy of the body real Gemini answers a 400 with."""

    return {
        "error": {
            "code": 400,
            "status": "INVALID_ARGUMENT",
            "details": [
                {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": reason}
            ],
        }
    }


def _probe_400(json_result=None, json_error=None):
    """probe_key against a faked 400 whose .json() returns or raises the given value."""

    response = MagicMock(status_code=400)
    response.json.side_effect = json_error
    response.json.return_value = json_result
    with patch.object(providers.requests, "get", MagicMock(return_value=response)):
        return providers.probe_key("gemini", "secret-key")


class TestProbeKey400:
    def test_gemini_api_key_invalid_is_rejected(self):
        assert _probe_400(_gemini_400("API_KEY_INVALID")) == "rejected"

    @pytest.mark.parametrize(
        "body", [_gemini_400("SOMETHING_ELSE"), {"error": {"code": 400}}, [], "x"]
    )
    def test_any_other_400_is_unverified(self, body):
        assert _probe_400(body) == "unverified"

    def test_an_unparseable_400_body_is_unverified(self):
        error = requests.JSONDecodeError("bad", "doc", 0)
        assert _probe_400(json_error=error) == "unverified"
