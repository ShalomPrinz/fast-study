from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import services.llm_client as llm_mod
from services.llm_client import DEFAULT_MODEL, LLMClient


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


def test_upload_file_forwards_path_and_mime(monkeypatch):
    sdk = MagicMock()
    sdk.files.upload.return_value = "handle"
    _patched_client(sdk, monkeypatch)

    result = LLMClient(api_key="k").upload_file("/tmp/t.txt", "text/plain")
    assert result == "handle"
    sdk.files.upload.assert_called_once_with(file="/tmp/t.txt", config={"mime_type": "text/plain"})


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
