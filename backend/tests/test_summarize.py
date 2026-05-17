from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from summarize import summarize


def _fake_run_ok(stdout: str = "# Title\nbody"):
    return SimpleNamespace(returncode=0, stdout=stdout, stderr="")


def _extract_prompt(call_args) -> str:
    cmd = call_args.args[0]
    return cmd[cmd.index("-p") + 1]


def _extract_include_dir(call_args) -> str:
    cmd = call_args.args[0]
    return cmd[cmd.index("--include-directories") + 1]


def test_summarize_without_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    with patch("summarize.subprocess.run", return_value=_fake_run_ok()) as mock_run:
        result = summarize(transcript)

    prompt = _extract_prompt(mock_run.call_args)
    assert f"The transcript is in the file: {transcript}" in prompt
    assert "material.pdf" not in prompt
    assert "Additional course material" not in prompt
    assert _extract_include_dir(mock_run.call_args) == str(transcript.parent)
    assert result.startswith("#")


def test_summarize_with_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")
    material = tmp_path / "material.pdf"
    material.write_bytes(b"%PDF-1.4\n")

    with patch("summarize.subprocess.run", return_value=_fake_run_ok()) as mock_run:
        summarize(transcript, material)

    prompt = _extract_prompt(mock_run.call_args)
    assert f"The transcript is in the file: {transcript}" in prompt
    assert str(material) in prompt
    assert "Additional course material" in prompt
    assert _extract_include_dir(mock_run.call_args) == str(transcript.parent)


def test_summarize_raises_on_gemini_failure_without_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")

    fail = SimpleNamespace(returncode=1, stdout="", stderr="boom")
    with patch("summarize.subprocess.run", return_value=fail):
        with pytest.raises(RuntimeError, match="boom"):
            summarize(transcript)


def test_summarize_raises_on_gemini_failure_with_material(tmp_path):
    transcript = tmp_path / "transcript.txt"
    transcript.write_text("hello")
    material = tmp_path / "material.pdf"
    material.write_bytes(b"%PDF-1.4\n")

    fail = SimpleNamespace(returncode=1, stdout="", stderr="boom")
    with patch("summarize.subprocess.run", return_value=fail):
        with pytest.raises(RuntimeError, match="boom"):
            summarize(transcript, material)
