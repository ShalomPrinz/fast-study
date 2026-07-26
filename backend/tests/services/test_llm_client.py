from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import services.llm_client as llm_mod
from services.llm_client import (
    DEFAULT_MODEL,
    GeminiRateLimitError,
    LLMClient,
    parse_gemini_rate_limit,
)


def _quota_body(
    quota_id: str, quota_value: str = "20", model: str = "gemini-3.5-flash"
) -> dict:
    """A trimmed copy of a real Gemini 429 RESOURCE_EXHAUSTED body."""
    return {
        "error": {
            "code": 429,
            "message": f"You exceeded your current quota... limit: {quota_value}, model: {model}",
            "status": "RESOURCE_EXHAUSTED",
            "details": [
                {
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    "violations": [
                        {
                            "quotaId": quota_id,
                            "quotaDimensions": {"model": model},
                            "quotaValue": quota_value,
                        }
                    ],
                },
                # Kept in the fixture because it is in the real body and we deliberately
                # ignore it: it says 59s even for a quota that resets at midnight.
                {
                    "@type": "type.googleapis.com/google.rpc.RetryInfo",
                    "retryDelay": "59s",
                },
            ],
        }
    }


class _SdkError(Exception):
    """Stand-in for google-genai's APIError, which exposes the body as `details`."""

    def __init__(self, details: dict, text: str = "429 RESOURCE_EXHAUSTED."):
        self.code = 429
        self.details = details
        super().__init__(text)


def _patched_client(genai_client, monkeypatch):
    """Patch genai.Client so LLMClient construction returns a mock SDK client."""
    monkeypatch.setattr(llm_mod.genai, "Client", MagicMock(return_value=genai_client))


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        LLMClient()


def test_uses_explicit_api_key_and_default_model(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    ctor = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(llm_mod.genai, "Client", ctor)

    client = LLMClient(api_key="explicit-key")
    ctor.assert_called_once_with(api_key="explicit-key")
    assert client.model == DEFAULT_MODEL


def test_generate_passes_model_and_strips(monkeypatch):
    sdk = MagicMock()
    sdk.models.generate_content.return_value = SimpleNamespace(text="  hi\nthere  \n")
    _patched_client(sdk, monkeypatch)

    client = LLMClient(model="m1", api_key="k")
    assert client.generate(["a", "b"]) == "hi\nthere"
    call = sdk.models.generate_content.call_args
    assert call.kwargs["model"] == "m1"
    assert call.kwargs["contents"] == ["a", "b"]


def test_generate_empty_response_returns_empty(monkeypatch):
    sdk = MagicMock()
    sdk.models.generate_content.return_value = SimpleNamespace(text=None)
    _patched_client(sdk, monkeypatch)
    assert LLMClient(api_key="k").generate(["x"]) == ""


def test_generate_wraps_errors_in_runtime_error(monkeypatch):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = Exception("boom")
    _patched_client(sdk, monkeypatch)
    with pytest.raises(RuntimeError, match="boom"):
        LLMClient(api_key="k").generate(["x"])


# ---- 429 quota parsing ----


def test_parse_daily_quota():
    info = parse_gemini_rate_limit(
        _quota_body("GenerateRequestsPerDayPerProjectPerModel-FreeTier")
    )
    assert info["is_daily"] is True
    assert info["quota_value"] == 20
    assert info["model"] == "gemini-3.5-flash"
    # The body's RetryInfo (59s) is never parsed — it lies for a daily quota.
    assert "retry_after_seconds" not in info


def test_parse_per_minute_quota():
    body = _quota_body(
        "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quota_value="15"
    )
    info = parse_gemini_rate_limit(body)
    assert info["is_daily"] is False
    assert info["quota_value"] == 15


def test_parse_unknown_quota_id_defaults_to_daily():
    """Safe direction: an unrecognised quotaId must not make the runner sleep an
    hour on a quota that won't come back."""
    info = parse_gemini_rate_limit(_quota_body("SomeFutureQuotaShape"))
    assert info["is_daily"] is True


def test_parse_missing_details_defaults_to_daily():
    info = parse_gemini_rate_limit(
        {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED"}}
    )
    assert info["is_daily"] is True
    assert info["quota_id"] is None and info["quota_value"] is None


def test_parse_falls_back_to_raw_error_text():
    """No structured body at all — dig the facts out of the stringified blob."""
    text = (
        "429 RESOURCE_EXHAUSTED. {'error': {'details': [{'violations': "
        "[{'quotaId': 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', 'quotaValue': '15'}]}]}} "
        "Please retry in 30.5s."
    )
    info = parse_gemini_rate_limit({}, text)
    assert info["is_daily"] is False
    assert info["quota_value"] == 15


def test_generate_raises_gemini_rate_limit_with_readable_message(monkeypatch):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = _SdkError(
        _quota_body("GenerateRequestsPerDayPerProjectPerModel-FreeTier")
    )
    _patched_client(sdk, monkeypatch)

    with pytest.raises(GeminiRateLimitError) as exc:
        LLMClient(api_key="k").generate(["x"])
    assert exc.value.info["is_daily"] is True
    # The whole point: the blob is gone.
    assert str(exc.value) == (
        "Gemini free-tier daily quota reached (20 requests/day for gemini-3.5-flash) — resets at midnight Pacific"
    )


def test_generate_non_429_still_raises_plain_runtime_error(monkeypatch):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = Exception("500 INTERNAL")
    _patched_client(sdk, monkeypatch)
    with pytest.raises(RuntimeError) as exc:
        LLMClient(api_key="k").generate(["x"])
    assert not isinstance(exc.value, GeminiRateLimitError)


def test_upload_file_forwards_path_and_mime(monkeypatch):
    sdk = MagicMock()
    sdk.files.upload.return_value = "handle"
    _patched_client(sdk, monkeypatch)

    result = LLMClient(api_key="k").upload_file("/tmp/t.txt", "text/plain")
    assert result == "handle"
    sdk.files.upload.assert_called_once_with(
        file="/tmp/t.txt", config={"mime_type": "text/plain"}
    )


def test_upload_file_wraps_errors_in_runtime_error(monkeypatch):
    sdk = MagicMock()
    sdk.files.upload.side_effect = Exception("boom")
    _patched_client(sdk, monkeypatch)
    with pytest.raises(RuntimeError, match="boom"):
        LLMClient(api_key="k").upload_file("/tmp/t.txt", "text/plain")


def test_delete_file_swallows_errors(monkeypatch):
    sdk = MagicMock()
    sdk.files.delete.side_effect = Exception("boom")
    _patched_client(sdk, monkeypatch)
    # Must not raise — best-effort cleanup.
    LLMClient(api_key="k").delete_file("files/handle1")
    sdk.files.delete.assert_called_once_with(name="files/handle1")
