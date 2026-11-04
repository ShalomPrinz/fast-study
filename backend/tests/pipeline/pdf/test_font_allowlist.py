"""Font guard: pass 1 of the golden fixture selects only fonts the PDF can draw (see docs/BIDI.md).
The allowlist below is the only copy; docs/PDF.md says when to extend it."""

import base64
import re
import shutil
import tempfile
from pathlib import Path

import pytest
import to_pdf
from pipeline.pdf.text import apply_outside_fences
from to_pdf import BUILD_STEM, build_tex, preprocess_markdown
from tools import tool_path

FIXTURE = Path(__file__).parent / "golden" / "summary.md"

# encoding/family/series/shape/size, as NFSS reports it; fontspec suffixes the family `(0)`/`(1)`.
ALLOWED = [
    re.compile(r"TU/NotoSansHebrew-Regular\(\d+\)/.*"),
    re.compile(r"TU/MiriamMonoCLM-Book\(\d+\)/.*"),
    re.compile(r"TU/lmr/m/n/10"),  # loaded at \begin{document}, never drawn
]

PROBE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
)
PROBE = (
    "\\makeatletter\\newwrite\\sftr\n"
    "\\IfFileExists{\\jobname.aux}{}{\\immediate\\openout\\sftr=sftr-first.txt}\n"
    "\\AddToHook{selectfont}{\\immediate\\write\\sftr"
    "{\\f@encoding/\\f@family/\\f@series/\\f@shape/\\f@size}}\\makeatother\n"
)


@pytest.mark.skipif(
    shutil.which(tool_path("pandoc")) is None, reason="pandoc not installed"
)
@pytest.mark.skipif(
    shutil.which(tool_path("tectonic")) is None, reason="tectonic not installed"
)
def test_pass_one_selects_only_allowed_fonts(monkeypatch):
    monkeypatch.delenv("TECTONIC_CACHE_DIR", raising=False)
    markdown = FIXTURE.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as build_dir:
        build = Path(build_dir)
        tex = build_tex(apply_outside_fences(markdown, preprocess_markdown), build)
        (build / "probe.png").write_bytes(PROBE_PNG)
        marker = "\\begin{document}"
        tex = tex.replace(marker, PROBE + marker, 1)
        (build / f"{BUILD_STEM}.tex").write_text(tex, encoding="utf-8")
        to_pdf._render(build, tex)
        trace = build / "sftr-first.txt"
        assert trace.exists(), to_pdf._read_log(build)[-2000:]
        selected = set(trace.read_text(encoding="utf-8").split())
    stray = sorted(s for s in selected if not any(a.fullmatch(s) for a in ALLOWED))
    assert not stray, f"TeX selected fonts the PDF never draws: {stray}"
