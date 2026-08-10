from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import summarize as summarize_mod
from summarize import summarize


def _make_client(response_text: str = "# Title\nbody"):
    """Build a fake LLMClient whose upload_file returns a sentinel handle and
    whose generate returns the given text."""
    client = MagicMock()
    counter = {"n": 0}

    def _upload(path, mime_type):
        counter["n"] += 1
        return SimpleNamespace(
            _path=path, _mime=mime_type, name=f"files/handle{counter['n']}"
        )

    client.upload_file.side_effect = _upload
    client.generate.return_value = response_text if response_text is not None else ""
    return client


def _generate_contents(client):
    return client.generate.call_args.args[0]


def _upload_calls(client):
    return client.upload_file.call_args_list


def test_summarize_without_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = _make_client()
    with patch.object(summarize_mod, "LLMClient", return_value=fake) as ctor:
        result = summarize(transcript)

    ctor.assert_called_once_with(model=summarize_mod.MODEL)

    uploads = _upload_calls(fake)
    assert len(uploads) == 1
    assert uploads[0].args == (transcript, "text/plain")

    contents = _generate_contents(fake)
    # Order: label, transcript, label, prompt — context first, instructions last.
    assert contents[0] == "--- MAIN TRANSCRIPT DOCUMENT ---"
    assert getattr(contents[1], "_mime", None) == "text/plain"
    assert contents[2] == "--- INSTRUCTIONS ---"
    base_prompt = summarize_mod.PROMPT_FILE.read_text(encoding="utf-8")
    assert contents[3].startswith(base_prompt)
    assert contents[3].endswith(summarize_mod.LENGTH_BUDGET_SUFFIX)
    assert summarize_mod.PDF_INSTRUCTION_SUFFIX not in contents[3]
    assert len(contents) == 4
    assert result == "# Title\nbody"


def test_summarize_with_empty_material_list(tmp_path):
    """An empty list is the no-material case — no PDF suffix, transcript only."""
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = _make_client()
    with patch.object(summarize_mod, "LLMClient", return_value=fake):
        summarize(transcript, [])

    assert len(_upload_calls(fake)) == 1
    contents = _generate_contents(fake)
    assert len(contents) == 4
    assert "--- SUPPLEMENTARY PDF DOCUMENTS ---" not in contents
    assert summarize_mod.PDF_INSTRUCTION_SUFFIX not in contents[3]


def test_summarize_with_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")
    material = tmp_path / "material.pdf"
    material.write_bytes(b"%PDF-1.4\n")

    fake = _make_client()
    with patch.object(summarize_mod, "LLMClient", return_value=fake):
        summarize(transcript, [material])

    uploads = _upload_calls(fake)
    assert len(uploads) == 2
    assert uploads[0].args == (transcript, "text/plain")
    assert uploads[1].args == (material, "application/pdf")

    contents = _generate_contents(fake)
    # Order: transcript-label, transcript, pdf-label, pdf, instr-label, prompt.
    assert len(contents) == 6
    assert contents[0] == "--- MAIN TRANSCRIPT DOCUMENT ---"
    assert getattr(contents[1], "_mime", None) == "text/plain"
    assert contents[2] == "--- SUPPLEMENTARY PDF DOCUMENTS ---"
    assert getattr(contents[3], "_mime", None) == "application/pdf"
    assert contents[4] == "--- INSTRUCTIONS ---"
    base_prompt = summarize_mod.PROMPT_FILE.read_text(encoding="utf-8")
    assert contents[5].startswith(base_prompt)
    # PDF suffix is appended before the length budget, so it lives in the middle.
    assert summarize_mod.PDF_INSTRUCTION_SUFFIX in contents[5]
    assert contents[5].endswith(summarize_mod.LENGTH_BUDGET_SUFFIX)
    assert contents[5].index(summarize_mod.PDF_INSTRUCTION_SUFFIX) < contents[5].index(
        summarize_mod.LENGTH_BUDGET_SUFFIX
    )


def test_summarize_with_several_materials(tmp_path):
    """All materials share one group marker and follow it in order."""
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")
    materials = []
    for name in ("material.pdf", "material.2.pdf", "material.3.pdf"):
        p = tmp_path / name
        p.write_bytes(b"%PDF-1.4\n")
        materials.append(p)

    fake = _make_client()
    with patch.object(summarize_mod, "LLMClient", return_value=fake):
        summarize(transcript, materials)

    uploads = _upload_calls(fake)
    assert len(uploads) == 4
    assert [c.args[0] for c in uploads[1:]] == materials
    assert all(c.args[1] == "application/pdf" for c in uploads[1:])

    contents = _generate_contents(fake)
    # transcript pair + one marker + 3 PDFs + instructions pair.
    assert len(contents) == 8
    assert contents.count("--- SUPPLEMENTARY PDF DOCUMENTS ---") == 1
    assert contents[2] == "--- SUPPLEMENTARY PDF DOCUMENTS ---"
    assert [getattr(c, "_path", None) for c in contents[3:6]] == materials
    assert contents[6] == "--- INSTRUCTIONS ---"
    # The prompt suffix is appended once, not once per material.
    assert contents[-1].count(summarize_mod.PDF_INSTRUCTION_SUFFIX) == 1
    assert contents[-1].endswith(summarize_mod.LENGTH_BUDGET_SUFFIX)


def test_summarize_deletes_every_uploaded_file(tmp_path):
    """Cleanup covers the transcript and all materials, even when generate fails."""
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")
    materials = []
    for name in ("material.pdf", "material.2.pdf"):
        p = tmp_path / name
        p.write_bytes(b"%PDF-1.4\n")
        materials.append(p)

    fake = _make_client()
    fake.generate.side_effect = RuntimeError("boom")
    with patch.object(summarize_mod, "LLMClient", return_value=fake):
        with pytest.raises(RuntimeError, match="boom"):
            summarize(transcript, materials)

    assert [c.args[0] for c in fake.delete_file.call_args_list] == [
        "files/handle1",
        "files/handle2",
        "files/handle3",
    ]


def test_summarize_raises_on_api_failure(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = MagicMock()
    fake.upload_file.side_effect = RuntimeError("boom")
    with patch.object(summarize_mod, "LLMClient", return_value=fake):
        with pytest.raises(RuntimeError, match="boom"):
            summarize(transcript)


def test_summarize_returns_empty_on_empty_response(tmp_path):
    """summarize() does NOT special-case an empty Gemini response — it returns ""
    and lets the runner's generic empty-file guard reject it. (Keeps all
    empty-output policy in one place; see runner._require_nonempty.)"""
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = _make_client(response_text=None)
    with patch.object(summarize_mod, "LLMClient", return_value=fake):
        assert summarize(transcript) == ""


def test_summarize_strips_but_preserves_leading_prose(tmp_path):
    """The old CLI implementation trimmed everything before the first '#'.
    Regression: that workaround must be gone — leading prose stays put,
    only outer whitespace is stripped. (LLMClient.generate already strips;
    the fake returns exactly what generate would.)"""
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fake = _make_client(response_text="intro paragraph\n# Title\nbody")
    with patch.object(summarize_mod, "LLMClient", return_value=fake):
        result = summarize(transcript)

    assert result == "intro paragraph\n# Title\nbody"
