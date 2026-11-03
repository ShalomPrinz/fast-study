"""The LaTeX golden: the pandoc half of the render, pinned.

Runs the fixture through the app's own path (`apply_outside_fences` + `build_tex`) with real
pandoc and compares against `golden/summary.tex`. `FASTSTUDY_BLESS=1` rewrites the golden.
"""

import difflib
import os
import re
import shutil
import tempfile
from pathlib import Path

import pytest
import to_pdf
from pipeline.pdf.text import apply_outside_fences
from to_pdf import PdfRenderError, build_tex, preprocess_markdown
from tools import tool_path

GOLDEN_DIR = Path(__file__).parent / "golden"
FIXTURE = GOLDEN_DIR / "summary.md"
GOLDEN = GOLDEN_DIR / "summary.tex"

pytestmark = pytest.mark.skipif(
    shutil.which(tool_path("pandoc")) is None, reason="pandoc not installed"
)


def _render(markdown: str) -> str:
    with tempfile.TemporaryDirectory() as build_dir:
        return build_tex(
            apply_outside_fences(markdown, preprocess_markdown), Path(build_dir)
        )


def test_summary_matches_golden():
    actual = _render(FIXTURE.read_text(encoding="utf-8"))
    if os.environ.get("FASTSTUDY_BLESS") == "1":
        GOLDEN.write_text(actual, encoding="utf-8", newline="\n")
    expected = GOLDEN.read_text(encoding="utf-8")
    diff = "".join(
        difflib.unified_diff(
            expected.splitlines(keepends=True),
            actual.splitlines(keepends=True),
            "golden/summary.tex",
            "actual",
        )
    )
    assert not diff, f"render drifted (FASTSTUDY_BLESS=1 to accept):\n{diff}"


def _handlers() -> list[str]:
    """Every top-level function in the filter — pandoc dispatches those by name."""

    source = to_pdf.DIRECTION_FILTER.read_text(encoding="utf-8")
    return re.findall(r"^function\s+(\w+)\s*\(", source, re.MULTILINE)


def test_fixture_reaches_every_filter_handler(tmp_path, monkeypatch):
    """Instrumented run: a copy of the filter has each handler wrapped to log whether it
    returned something (acted). A handler added to the filter is wrapped automatically, so a
    fixture that never exercises it fails here."""

    handlers = _handlers()
    assert {"CodeBlock", "Div", "Table"} <= set(handlers)
    log = tmp_path / "calls.log"
    wrapped = to_pdf.DIRECTION_FILTER.read_text(encoding="utf-8") + "\n"
    wrapped += f"local __log = {str(log)!r}\n"
    wrapped += "for _, name in ipairs({%s}) do\n" % ", ".join(
        f"'{h}'" for h in handlers
    )
    wrapped += "  local inner = _G[name]\n"
    wrapped += "  _G[name] = function(...)\n"
    wrapped += "    local out = inner(...)\n"
    wrapped += "    local f = io.open(__log, 'a')\n"
    wrapped += "    f:write(name .. (out ~= nil and ' acted' or ' passed') .. '\\n')\n"
    wrapped += "    f:close()\n"
    wrapped += "    return out\n  end\nend\n"
    probe = tmp_path / "text_direction.lua"
    probe.write_text(wrapped, encoding="utf-8")
    monkeypatch.setattr(to_pdf, "DIRECTION_FILTER", probe)

    _render(FIXTURE.read_text(encoding="utf-8"))

    calls = set(log.read_text(encoding="utf-8").splitlines())
    for handler in handlers:
        assert f"{handler} acted" in calls, f"fixture never makes {handler} act"


def test_broken_filter_is_a_coded_pandoc_failure(tmp_path, monkeypatch):
    bad = tmp_path / "bad.lua"
    bad.write_text("function CodeBlock(el\n", encoding="utf-8")
    monkeypatch.setattr(to_pdf, "DIRECTION_FILTER", bad)

    with pytest.raises(PdfRenderError) as caught:
        _render("שלום\n")

    err = caught.value
    assert err.code == "pdf_pandoc_failed"
    assert "Error running filter" in err.params["detail"]
    assert "')' expected near <eof>" in err.params["detail"]


def test_missing_template_is_a_coded_pandoc_failure(tmp_path, monkeypatch):
    missing = tmp_path / "nope.tex"
    monkeypatch.setattr(to_pdf, "resource_path", lambda *_parts: missing)

    with pytest.raises(PdfRenderError) as caught:
        _render("שלום\n")

    err = caught.value
    assert err.code == "pdf_pandoc_failed"
    assert "nope.tex" in err.params["detail"]
