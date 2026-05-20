from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import summarize as summarize_mod
from summarize import summarize


def _make_client(response_text: str = "# Title\nbody"):
    """Build a fake genai client whose files.upload returns a sentinel handle
    and whose models.generate_content returns the given text."""
    client = MagicMock()
    client.files.upload.side_effect = lambda file, config: SimpleNamespace(
        _path=file, _mime=config["mime_type"]
    )
    client.models.generate_content.return_value = SimpleNamespace(text=response_text)
    return client


def _generate_call(client):
    return client.models.generate_content.call_args


def _upload_calls(client):
    return client.files.upload.call_args_list


def test_summarize_without_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = _make_client()
    with patch.object(summarize_mod, "_build_client", return_value=fake):
        result = summarize(transcript)

    uploads = _upload_calls(fake)
    assert len(uploads) == 1
    assert uploads[0].kwargs["file"] == str(transcript)
    assert uploads[0].kwargs["config"] == {"mime_type": "text/plain"}

    call = _generate_call(fake)
    contents = call.kwargs["contents"]
    assert contents[0] == summarize_mod.PROMPT_FILE.read_text(encoding="utf-8")
    assert getattr(contents[1], "_mime", None) == "text/plain"
    assert len(contents) == 2  # no PDF part
    assert call.kwargs["model"] == summarize_mod.MODEL
    assert result == "# Title\nbody"


def test_summarize_with_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")
    material = tmp_path / "material.pdf"
    material.write_bytes(b"%PDF-1.4\n")

    fake = _make_client()
    with patch.object(summarize_mod, "_build_client", return_value=fake):
        summarize(transcript, material)

    uploads = _upload_calls(fake)
    assert len(uploads) == 2
    assert uploads[0].kwargs["config"] == {"mime_type": "text/plain"}
    assert uploads[0].kwargs["file"] == str(transcript)
    assert uploads[1].kwargs["config"] == {"mime_type": "application/pdf"}
    assert uploads[1].kwargs["file"] == str(material)

    contents = _generate_call(fake).kwargs["contents"]
    assert len(contents) == 3
    mimes = [getattr(c, "_mime", None) for c in contents[1:]]
    assert mimes == ["text/plain", "application/pdf"]


def test_summarize_raises_on_api_failure(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = MagicMock()
    fake.files.upload.side_effect = Exception("boom")
    with patch.object(summarize_mod, "_build_client", return_value=fake):
        with pytest.raises(RuntimeError, match="boom"):
            summarize(transcript)


def test_summarize_strips_but_preserves_leading_prose(tmp_path):
    """The old CLI implementation trimmed everything before the first '#'.
    Regression: that workaround must be gone — leading prose stays put,
    only outer whitespace is stripped."""
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = _make_client(response_text="  \n\nintro paragraph\n# Title\nbody\n  ")
    with patch.object(summarize_mod, "_build_client", return_value=fake):
        result = summarize(transcript)

    assert result == "intro paragraph\n# Title\nbody"
