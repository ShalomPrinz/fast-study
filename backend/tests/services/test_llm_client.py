from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
import services.llm_client as llm_mod
from google.genai import types
from services.errors import CodedError
from services.llm_client import (
    GeminiRateLimitError,
    LLMClient,
    parse_gemini_rate_limit,
)
from services.settings import gemini_model


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

    def __init__(
        self, details: dict, text: str = "429 RESOURCE_EXHAUSTED.", code: int = 429
    ):
        self.code = code
        self.details = details
        super().__init__(text)


def _patched_client(genai_client, monkeypatch):
    """Patch genai.Client so LLMClient construction returns a mock SDK client."""
    monkeypatch.setattr(llm_mod.genai, "Client", MagicMock(return_value=genai_client))


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY") as exc:
        LLMClient()
    assert (exc.value.code, exc.value.params) == (
        "missing_api_key",
        {"provider": "gemini"},
    )


def test_uses_explicit_api_key_and_default_model(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    ctor = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(llm_mod.genai, "Client", ctor)

    client = LLMClient(api_key="explicit-key")
    ctor.assert_called_once_with(
        api_key="explicit-key",
        vertexai=False,
        http_options=types.HttpOptions(
            base_url="https://generativelanguage.googleapis.com/", timeout=600_000
        ),
    )
    assert client.model == gemini_model()


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
    # The same facts as the sentence, named — so a renderer can word them its own way.
    assert exc.value.code == "gemini_quota_exhausted"
    assert exc.value.params == {
        "scope": "daily",
        "model": "gemini-3.5-flash",
        "limit": 20,
        "tier": "free",
    }


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


# ---- rejected key ----

_INVALID_KEY_BODY = {
    "error": {
        "code": 400,
        "status": "INVALID_ARGUMENT",
        "details": [
            {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                "reason": "API_KEY_INVALID",
            }
        ],
    }
}


@pytest.mark.parametrize(
    "error",
    [
        _SdkError(_INVALID_KEY_BODY, "400 INVALID_ARGUMENT", code=400),
        _SdkError({}, "401 UNAUTHENTICATED", code=401),
        _SdkError({}, "403 PERMISSION_DENIED", code=403),
    ],
)
@pytest.mark.parametrize("call", ["generate", "upload_file"])
def test_a_rejected_key_raises_api_key_rejected(monkeypatch, error, call):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = error
    sdk.files.upload.side_effect = error
    _patched_client(sdk, monkeypatch)
    client = LLMClient(api_key="k")

    with pytest.raises(CodedError) as exc:
        if call == "generate":
            client.generate(["x"])
        else:
            client.upload_file("/tmp/t.txt", "text/plain")
    assert (exc.value.code, exc.value.params) == (
        "api_key_rejected",
        {"provider": "gemini"},
    )


def test_another_400_stays_a_plain_runtime_error(monkeypatch):
    body = {"error": {"code": 400, "status": "INVALID_ARGUMENT"}}
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = _SdkError(body, "400 bad", code=400)
    _patched_client(sdk, monkeypatch)
    with pytest.raises(RuntimeError) as exc:
        LLMClient(api_key="k").generate(["x"])
    assert not isinstance(exc.value, CodedError)


_OVERLOADED_MESSAGE = (
    "This model is currently experiencing high demand. Spikes in demand are usually "
    "temporary. Please try again later."
)


@pytest.mark.parametrize(
    "error",
    [
        # The SDK's APIError shape: status code on the exception, body as `details`.
        _SdkError(
            {
                "error": {
                    "code": 503,
                    "message": _OVERLOADED_MESSAGE,
                    "status": "UNAVAILABLE",
                }
            },
            text="503 UNAVAILABLE.",
            code=503,
        ),
        # No code attribute: only the dict body names the condition.
        _SdkError({"code": 503, "status": "UNAVAILABLE"}, text="?", code=None),
    ],
)
@pytest.mark.parametrize("call", ["generate", "upload_file"])
def test_a_503_raises_gemini_overloaded(monkeypatch, error, call):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = error
    sdk.files.upload.side_effect = error
    _patched_client(sdk, monkeypatch)
    client = LLMClient(api_key="k", model="gemini-x")

    with pytest.raises(CodedError) as exc:
        if call == "generate":
            client.generate(["x"])
        else:
            client.upload_file("/tmp/a.txt", "text/plain")
    assert exc.value.code == "gemini_overloaded"
    assert exc.value.params == {"model": "gemini-x"}
    assert "{" not in str(exc.value)  # readable prose, not the JSON blob


def _overloaded():
    return _SdkError(
        {"error": {"code": 503, "status": "UNAVAILABLE", "message": "busy"}},
        text="503 UNAVAILABLE.",
        code=503,
    )


def _fallback_client(monkeypatch, effects, model):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = effects
    _patched_client(sdk, monkeypatch)
    return sdk, LLMClient(api_key="k", model=model)


def _models_called(sdk):
    return [c.kwargs["model"] for c in sdk.models.generate_content.call_args_list]


def test_503_without_auto_fallback_does_not_retry(monkeypatch):
    monkeypatch.delenv("GEMINI_AUTO_FALLBACK", raising=False)
    sdk, client = _fallback_client(monkeypatch, [_overloaded()], "gemini-3.8-flash")
    with pytest.raises(CodedError) as exc:
        client.generate(["x"])
    assert exc.value.code == "gemini_overloaded"
    assert _models_called(sdk) == ["gemini-3.8-flash"]


def test_503_with_auto_fallback_retries_on_next_model_once(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTO_FALLBACK", "true")
    seen = []
    token = llm_mod.fallback_hook.set(lambda a, b: seen.append((a, b)))
    try:
        sdk, client = _fallback_client(
            monkeypatch,
            [_overloaded(), SimpleNamespace(text=" ok ")],
            "gemini-3.8-flash",
        )
        assert client.generate(["x"]) == "ok"
        assert _models_called(sdk) == ["gemini-3.8-flash", "gemini-3.6-flash"]
        assert seen == [("gemini-3.8-flash", "gemini-3.6-flash")]
        assert client.model == "gemini-3.8-flash"  # per call only
    finally:
        llm_mod.fallback_hook.reset(token)


def test_fallback_wraps_round_to_the_first_model(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTO_FALLBACK", "true")
    sdk, client = _fallback_client(
        monkeypatch, [_overloaded(), SimpleNamespace(text="ok")], "gemini-3.6-flash"
    )
    client.generate(["x"])
    assert _models_called(sdk) == ["gemini-3.6-flash", "gemini-3.8-flash"]


def test_both_models_503_raises_the_original_overloaded(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTO_FALLBACK", "true")
    sdk, client = _fallback_client(
        monkeypatch, [_overloaded(), _overloaded(), _overloaded()], "gemini-3.8-flash"
    )
    with pytest.raises(CodedError) as exc:
        client.generate(["x"])
    assert exc.value.code == "gemini_overloaded"
    assert exc.value.params == {"model": "gemini-3.8-flash"}
    assert len(_models_called(sdk)) == 2


def test_fallback_429_raises_the_original_overloaded(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTO_FALLBACK", "true")
    sdk, client = _fallback_client(
        monkeypatch,
        [
            _overloaded(),
            _SdkError(_quota_body("GenerateRequestsPerDayPerProjectPerModel")),
        ],
        "gemini-3.8-flash",
    )
    with pytest.raises(CodedError) as exc:
        client.generate(["x"])
    assert exc.value.code == "gemini_overloaded"
    assert exc.value.params == {"model": "gemini-3.8-flash"}
    assert isinstance(exc.value.__cause__, GeminiRateLimitError)


def test_429_never_falls_back(monkeypatch):
    monkeypatch.setenv("GEMINI_AUTO_FALLBACK", "true")
    sdk, client = _fallback_client(
        monkeypatch,
        [_SdkError(_quota_body("GenerateRequestsPerDayPerProjectPerModel"))],
        "gemini-3.8-flash",
    )
    with pytest.raises(GeminiRateLimitError):
        client.generate(["x"])
    assert len(_models_called(sdk)) == 1


def test_client_is_built_with_a_ten_minute_timeout(monkeypatch):
    sdk = MagicMock()
    _patched_client(sdk, monkeypatch)
    LLMClient(api_key="k")
    opts = llm_mod.genai.Client.call_args.kwargs["http_options"]
    assert opts.timeout == 600_000


@pytest.mark.parametrize("call", ["generate", "upload"])
def test_a_timeout_raises_gemini_timeout(monkeypatch, call):
    sdk = MagicMock()
    err = httpx.ReadTimeout("stalled")
    sdk.models.generate_content.side_effect = err
    sdk.files.upload.side_effect = err
    _patched_client(sdk, monkeypatch)
    client = LLMClient(api_key="k", model="m")
    with pytest.raises(CodedError) as exc:
        if call == "generate":
            client.generate(["x"])
        else:
            client.upload_file("/tmp/t.txt", "text/plain")
    assert exc.value.code == "gemini_timeout"
    assert exc.value.params == {"model": "m", "seconds": 600}


@pytest.mark.parametrize(
    "error",
    [
        _SdkError(
            {"error": {"code": 504, "status": "DEADLINE_EXCEEDED"}},
            text="504 DEADLINE_EXCEEDED.",
            code=504,
        ),
        _SdkError({"code": 504, "status": "DEADLINE_EXCEEDED"}, text="?", code=None),
    ],
)
@pytest.mark.parametrize("call", ["generate", "upload"])
def test_a_504_deadline_exceeded_raises_gemini_timeout(monkeypatch, error, call):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = error
    sdk.files.upload.side_effect = error
    _patched_client(sdk, monkeypatch)
    client = LLMClient(api_key="k", model="m")
    with pytest.raises(CodedError) as exc:
        if call == "generate":
            client.generate(["x"])
        else:
            client.upload_file("/tmp/t.txt", "text/plain")
    assert exc.value.code == "gemini_timeout"
    assert exc.value.params == {"model": "m", "seconds": 600}


def test_a_timeout_never_falls_back(monkeypatch):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = httpx.ReadTimeout("stalled")
    _patched_client(sdk, monkeypatch)
    monkeypatch.setattr(llm_mod, "gemini_auto_fallback", lambda: True)
    with pytest.raises(CodedError):
        LLMClient(api_key="k").generate(["x"])
    assert sdk.models.generate_content.call_count == 1
