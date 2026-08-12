import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pipeline.pdf.math_fixes import merge_ltr_math, merge_rtl_math_number
from to_pdf import (
    FONTS_DIR,
    LATEX_HEADER,
    LTR_CODE_FILTER,
    PdfRenderError,
    convert_to_pdf,
)

# ---------------------------------------------------------------------------
# Preprocessing chain order
# ---------------------------------------------------------------------------

# Inputs in post-wrap_math_text_dir shape (the \RL{} is already on the Hebrew body),
# spanning both adjacencies: number before/after the \text{}, zero-gap and spaced,
# \LR{} on either side, and an \LR{} body ending in a digit.
MERGE_INPUTS = [
    r"\LR{\texttt{cells}} $240 \text{\RL{תאים}}$",
    r"\LR{\texttt{cells}} $240\text{\RL{תאים}}$",
    r"\LR{\texttt{cells}}$240 \text{\RL{תאים}}$",
    r"\LR{\texttt{cells}} $\text{\RL{תיוג}}\  1$",
    r"$\text{\RL{תיוג}}\  1$ \LR{\texttt{cells}}",
    r"$240 \text{\RL{תאים}}$ \LR{RDI}",
    r"\LR{v2}$5 \text{\RL{תאים}}$",
    r"\LR{240} $\text{\RL{תאים}}$",
    r"$240 \text{\RL{תאים}}$",
]


class TestMergesCommute:
    """`preprocess` runs merge_rtl_math_number then merge_ltr_math, but that order is
    not load-bearing today — this fails loudly if a change ever makes it so."""

    @pytest.mark.parametrize("text", MERGE_INPUTS)
    def test_either_order_gives_the_same_result(self, text):
        assert merge_ltr_math(merge_rtl_math_number(text)) == merge_rtl_math_number(
            merge_ltr_math(text)
        )

    def test_chain_order_output_is_pinned(self):
        # Both sides being equally broken would satisfy commutativity — pin the value.
        assert merge_ltr_math(merge_rtl_math_number(MERGE_INPUTS[0])) == (
            r"\LR{\texttt{cells} $\text{\RL{\ensuremath{240} תאים}}$}"
        )


# ---------------------------------------------------------------------------
# Lua filter — integration test via `pandoc --to=latex`
# ---------------------------------------------------------------------------


def _pandoc_available():
    return shutil.which("pandoc") is not None


@pytest.mark.skipif(not _pandoc_available(), reason="pandoc not installed")
class TestLuaFilterLtrCodeBlock:
    def _run_pandoc_latex(self, md: str) -> str:
        """Run pandoc with ltr_code.lua and return the LaTeX body."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False, encoding="utf-8"
        ) as f:
            f.write(md)
            md_path = f.name
        try:
            result = subprocess.run(
                [
                    "pandoc",
                    md_path,
                    "--to=latex",
                    f"--lua-filter={LTR_CODE_FILTER}",
                ],
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, f"pandoc failed:\n{result.stderr}"
            return result.stdout
        finally:
            os.unlink(md_path)

    def test_code_block_wrapped_in_english(self):
        # Core structure: every code block must be wrapped in
        # \begin{english}...\end{english} (polyglossia language switch).
        # This sets the LOCAL base direction to LTR, which both fixes word
        # order AND disables character mirroring inside fancyvrb's Verbatim.
        # \begin{LTR} (bidi run direction) alone fixes word order but NOT
        # mirroring — see ltr_code.lua for the full rationale.
        latex = self._run_pandoc_latex("```\nGET /index.html HTTP/1.1\n```\n")
        assert r"\begin{english}" in latex
        assert r"\end{english}" in latex

    def test_english_wraps_verbatim_for_plain_blocks(self):
        # Plain code block (no language tag) → verbatim is inside english.
        latex = self._run_pandoc_latex("```\nsome code\n```\n")
        assert latex.index(r"\begin{english}") < latex.index(r"\begin{verbatim}")
        assert latex.index(r"\end{verbatim}") < latex.index(r"\end{english}")

    def test_english_wraps_shaded_for_highlighted_blocks(self):
        # Syntax-highlighted block (language tag) → Shaded/Highlighting inside
        # english. Highlighting is preserved (colours still work); english
        # wraps the whole thing.
        latex = self._run_pandoc_latex("```python\nimport os\n```\n")
        assert r"\begin{Shaded}" in latex
        assert latex.index(r"\begin{english}") < latex.index(r"\begin{Shaded}")
        assert latex.index(r"\end{Shaded}") < latex.index(r"\end{english}")

    def test_code_block_content_preserved(self):
        latex = self._run_pandoc_latex("```\nGET /index.html HTTP/1.1\n```\n")
        assert "GET /index.html HTTP/1.1" in latex

    def test_brackets_in_source_unmangled(self):
        # The literal bracket characters must appear in the LaTeX source.
        # The polyglossia english environment around them disables XeTeX
        # character mirroring at render time.
        latex = self._run_pandoc_latex(
            "```javascript\napp.get('/', (req, res) => {\n```\n"
        )
        assert "(" in latex
        assert "{" in latex
        # The earlier \LTRverbatim attempt caused "undefined" errors — guard.
        assert r"\begin{LTRverbatim}" not in latex

    def test_json_block_syntax_highlighted(self):
        # JSON block must use Shaded/Highlighting (colours preserved).
        md = '```json\n{\n  "method": "GET",\n  "url": "/index.html"\n}\n```\n'
        latex = self._run_pandoc_latex(md)
        assert r"\begin{english}" in latex
        assert r"\begin{Shaded}" in latex
        # Content appears in tokenised form (e.g. \StringTok, \DataTypeTok)
        assert '"method"' in latex
        assert '"GET"' in latex

    def test_multiple_code_blocks_each_wrapped(self):
        md = "```\nblock one\n```\n\nsome prose\n\n```\nblock two\n```\n"
        latex = self._run_pandoc_latex(md)
        assert latex.count(r"\begin{english}") == 2
        assert latex.count(r"\end{english}") == 2

    def test_prose_without_code_block_not_wrapped(self):
        # Plain paragraphs must not get spurious english-env wrapping.
        latex = self._run_pandoc_latex("Just a paragraph with no code.\n")
        assert r"\begin{english}" not in latex

    def test_filter_file_exists(self):
        assert LTR_CODE_FILTER.exists(), f"filter missing: {LTR_CODE_FILTER}"


# ---------------------------------------------------------------------------
# Mono font for code blocks — must cover Hebrew
#
# Code blocks are wrapped in \begin{english} (ltr_code.lua), and fancyvrb's
# Verbatim uses the GLOBAL \ttfamily — NOT polyglossia's \englishfonttt gloss.
# A Latin-only mono (Noto Sans Mono / Latin Modern Mono) makes Hebrew comments
# render as notdef boxes. The fix bundles the dual-script monospace Miriam Mono
# CLM and points \setmonofont at it. These guard against a silent regression to
# a Hebrew-less mono.
# ---------------------------------------------------------------------------


class TestMonoFontWiring:
    def test_miriam_mono_files_bundled(self):
        for name in ("MiriamMonoCLM-Book.ttf", "MiriamMonoCLM-Bold.ttf"):
            assert (FONTS_DIR / name).exists(), f"missing bundled mono font: {name}"

    def test_setmonofont_points_at_miriam(self):
        # Verbatim picks up the global mono font, so it must be set explicitly.
        assert r"\setmonofont{MiriamMonoCLM-Book}" in LATEX_HEADER

    def test_no_hebrewless_system_mono(self):
        # Noto Sans Mono has no Hebrew glyphs — must not be the code font.
        assert "Noto Sans Mono" not in LATEX_HEADER


# ---------------------------------------------------------------------------
# Full PDF render — the canonical bidi/font verification (see docs/PDF.md).
# Glyph fallback happens at XeLaTeX render time; string-level tests cannot catch
# a missing-Hebrew mono. Gated on the real toolchain (xelatex + pandoc + fitz).
# ---------------------------------------------------------------------------


def _xelatex_available():
    return shutil.which("xelatex") is not None


def _pymupdf_available():
    try:
        import fitz  # noqa: F401

        return True
    except ImportError:
        return False


@pytest.mark.skipif(
    not (_xelatex_available() and _pandoc_available() and _pymupdf_available()),
    reason="needs xelatex + pandoc + pymupdf to render and inspect a real PDF",
)
class TestHebrewInCodeBlockRenders:
    # Hebrew comment inside an assembly block — the exact regression report.
    MD = (
        "הפרולוג מייצר את מסגרת המחסנית החדשה עם כניסתנו לפונקציה:\n"
        "```assembly\n"
        "pushq %rbp          # שמירת בסיס המחסנית הישן של הפונקציה הקוראת\n"
        "movq %rsp, %rbp     # הגדרת בסיס המחסנית החדש במיקום הנוכחי של RSP\n"
        "```\n"
    )

    def _render_text(self) -> str:
        import fitz

        with tempfile.TemporaryDirectory() as d:
            md_path = os.path.join(d, "snippet.md")
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(self.MD)
            pdf_path, _ = convert_to_pdf(md_path)
            try:
                return fitz.open(pdf_path).load_page(0).get_text()
            finally:
                os.unlink(pdf_path)

    def test_no_notdef_glyphs_in_code_block(self):
        # ￿ is what pymupdf emits for a notdef (missing) glyph — the bug.
        assert "￿" not in self._render_text()

    def test_hebrew_comment_words_rendered(self):
        text = self._render_text()
        # Words from the Hebrew comments must be present (PDF text order is
        # visual, so check membership of whole words, not the full line).
        for word in ("שמירת", "בסיס", "המחסנית", "הגדרת"):
            assert word in text, (
                f"Hebrew word {word!r} missing from rendered code block"
            )


@pytest.mark.skipif(
    not (_xelatex_available() and _pandoc_available() and _pymupdf_available()),
    reason="needs xelatex + pandoc + pymupdf to render and inspect a real PDF",
)
class TestBidiOrderingRenders:
    # The canonical bidi verification for the five overview→PDF ordering bugs.
    # We read glyphs in TRUE visual (x-coordinate) order (see docs/PDF.md): RTL
    # Hebrew comes out reversed, but the ORDER/ADJACENCY of the LTR islands is
    # faithful — which is exactly what these fixes are about. A get_text()
    # substring check would lie here (docs/PDF.md, PyMuPDF caveat).
    def _visual_text(self, md: str) -> str:
        from collections import defaultdict

        import fitz

        with tempfile.TemporaryDirectory() as d:
            md_path = os.path.join(d, "s.md")
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(md)
            pdf_path, _ = convert_to_pdf(md_path)
            try:
                page = fitz.open(pdf_path).load_page(0).get_text("rawdict")
            finally:
                os.unlink(pdf_path)
        lines = defaultdict(list)
        for b in page["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    for c in s["chars"]:
                        lines[round(c["origin"][1])].append((c["origin"][0], c["c"]))
        return "\n".join(
            "".join(ch for _, ch in sorted(lines[y])) for y in sorted(lines)
        )

    def test_issue1_math_text_islands_keep_source_order(self):
        # English \text{} islands inside display math stay in source order; the
        # middle multi-word island is not reversed.
        md = (
            "$$S = \\{M(x) = 1 \\text{ within } 2^{g} "
            "\\text{ steps and using at most } g \\text{ space}\\}$$\n"
        )
        vis = self._visual_text(md)
        assert "steps and using at most" in vis
        assert "most at using and steps" not in vis

    def test_issue2_number_list_in_code_ordered(self):
        vis = self._visual_text("בטראק `98, 183, 37` הבא\n")
        assert "98, 183, 37" in vis
        assert ",98 ,183" not in vis

    def test_issue3_parenthesized_acronym_ordered(self):
        vis = self._visual_text("עקרון (FIFO - First-In, First-Out) כאן\n")
        assert "FIFO - First-In, First-Out" in vis

    def test_issue4_number_unit_ordered(self):
        vis = self._visual_text("בין 4KB ל-64KB כאן\n")
        assert "4KB" in vis and "64KB" in vis
        assert "KB4" not in vis

    def test_issue5_underscore_identifier_literal(self):
        # _exit / _Exit render as literal identifiers, not "subscript e + xit".
        vis = self._visual_text("ש-$_exit$ (או $_Exit$) היא\n")
        assert "_exit" in vis and "_Exit" in vis

    def test_issue6_hebrew_math_text_keeps_rtl_order(self):
        # A Hebrew \text{} body forced into \LR renders "ואילך 2 שלב"; \RL keeps
        # the RTL word order (x-order below is each word reversed, as expected).
        vis = self._visual_text("$$A = \\text{שלב 2 ואילך}$$\n")
        assert "ךליאו2בלש" in vis
        assert "בלש2ךליאו" not in vis

    def test_issue7_possessive_phrase_is_one_island(self):
        # "Bayes' Rule" as two islands reverses to "(Rule 'Bayes)".
        vis = self._visual_text("חוק בייס (Bayes' Rule)\n")
        assert "(Bayes' Rule)" in vis
        assert "(Rule 'Bayes)" not in vis


# ---------------------------------------------------------------------------
# Two-pass render: pandoc → build.tex, then xelatex twice with nonstopmode.
# Every subprocess is mocked — no real pandoc/XeLaTeX here (the real-toolchain
# renders above cover that).
# ---------------------------------------------------------------------------

ERROR_LOG = "! Undefined control sequence.\nl.417 \\Pi\n"


class FakeRun:
    """Stand-in for subprocess.run that materialises what each tool would leave in cwd."""

    def __init__(
        self,
        *,
        pandoc_rc=0,
        xelatex_rcs=(0, 0),
        pdf_bytes=b"%PDF-1.4 stub",
        log_text="",
        pandoc_stderr="",
        tex_text="\\documentclass{article}\\begin{document}x\\end{document}",
        hangs=(),
    ):
        self.pandoc_rc = pandoc_rc
        self.xelatex_rcs = list(xelatex_rcs)
        self.pdf_bytes = pdf_bytes
        self.log_text = log_text
        self.pandoc_stderr = pandoc_stderr
        self.tex_text = tex_text
        # Tools that time out instead of returning: "xelatex" on every call, "xelatex:2"
        # only on its second.
        self.hangs = set(hangs)
        self.calls = []

    def __call__(self, cmd, capture_output=False, text=False, cwd=None, timeout=None):
        self.calls.append((list(cmd), cwd))
        nth = sum(1 for c, _ in self.calls if c[0] == cmd[0])
        d = Path(cwd)
        if cmd[0] in self.hangs or f"{cmd[0]}:{nth}" in self.hangs:
            # A killed xelatex has already truncated and partly rewritten its outputs —
            # what is left is a headerless fragment, never the previous pass's file.
            if cmd[0] == "xelatex":
                (d / "build.pdf").write_bytes(b"%PDF-trunc")
                (d / "build.log").write_text("truncated", encoding="utf-8")
            raise subprocess.TimeoutExpired(cmd, timeout)
        if cmd[0] == "pandoc":
            if self.pandoc_rc == 0:
                (d / "build.tex").write_text(self.tex_text, encoding="utf-8")
            return SimpleNamespace(
                returncode=self.pandoc_rc, stdout="", stderr=self.pandoc_stderr
            )
        (d / "build.log").write_text(self.log_text, encoding="utf-8")
        if self.pdf_bytes is not None:
            (d / "build.pdf").write_bytes(self.pdf_bytes)
        rc = self.xelatex_rcs[min(len(self.calls) - 2, len(self.xelatex_rcs) - 1)]
        return SimpleNamespace(returncode=rc, stdout=self.log_text, stderr="")

    @property
    def pandoc_cmd(self):
        return self.calls[0][0]

    @property
    def xelatex_cmds(self):
        return [cmd for cmd, _ in self.calls if cmd[0] == "xelatex"]


@contextmanager
def _render(fake: FakeRun, md: str = "שלום world\n"):
    """Run convert_to_pdf over a temp markdown file with `fake` standing in for subprocess."""

    with tempfile.TemporaryDirectory() as d:
        md_path = Path(d) / "summary.md"
        md_path.write_text(md, encoding="utf-8")
        with patch("subprocess.run", fake):
            yield str(md_path)


class TestTwoPassInvocation:
    def test_pandoc_writes_tex_not_pdf_and_drops_pdf_engine(self):
        fake = FakeRun()
        with _render(fake) as md_path:
            convert_to_pdf(md_path)
        cmd = fake.pandoc_cmd
        assert cmd[cmd.index("-o") + 1] == "build.tex"
        # pandoc no longer runs the engine — that is pass 2's job.
        assert not any(a.startswith("--pdf-engine") for a in cmd)

    def test_pandoc_keeps_every_existing_flag(self):
        fake = FakeRun()
        with _render(fake) as md_path:
            convert_to_pdf(md_path)
        cmd = fake.pandoc_cmd
        assert "--from=markdown-smart" in cmd
        assert "--standalone" in cmd
        assert any(a.startswith("--template=") for a in cmd)
        assert any(a.startswith("--include-in-header=") for a in cmd)
        assert any(a.startswith("--lua-filter=") for a in cmd)
        assert cmd.count("-V") == 2
        assert "geometry:margin=2.5cm" in cmd
        assert "linestretch=1.3" in cmd

    def test_xelatex_runs_twice_in_nonstopmode(self):
        # Twice for hyperref/bookmark reference stability; nonstopmode is the recovery lever.
        fake = FakeRun()
        with _render(fake) as md_path:
            convert_to_pdf(md_path)
        cmds = fake.xelatex_cmds
        assert len(cmds) == 2
        for cmd in cmds:
            assert cmd == ["xelatex", "-interaction=nonstopmode", "build.tex"]

    def test_aux_files_stay_in_a_tempdir_and_pdf_lands_on_output_path(self):
        fake = FakeRun()
        with _render(fake) as md_path:
            pdf_path, warning = convert_to_pdf(md_path)
            assert pdf_path == str(Path(md_path).with_suffix(".pdf"))
            assert Path(pdf_path).read_bytes() == b"%PDF-1.4 stub"
            assert warning is None
            # Nothing but the markdown and the PDF beside it — the build dir is gone.
            assert sorted(p.name for p in Path(md_path).parent.iterdir()) == [
                "summary.md",
                "summary.pdf",
            ]
        build_dir = fake.calls[0][1]
        assert not Path(build_dir).exists()


class TestRenderRecovery:
    def test_nonzero_exit_with_usable_pdf_returns_warning(self):
        fake = FakeRun(xelatex_rcs=(1, 1), log_text=ERROR_LOG)
        with _render(fake) as md_path:
            pdf_path, warning = convert_to_pdf(md_path)
            assert Path(pdf_path).exists()
        assert warning == r"LaTeX error: Undefined control sequence (line 417: \Pi)"

    def test_nonzero_exit_without_reported_error_still_warns(self):
        fake = FakeRun(xelatex_rcs=(1, 1), log_text="no bang lines here\n")
        with _render(fake) as md_path:
            _, warning = convert_to_pdf(md_path)
        assert warning and "\n" not in warning.splitlines()[0]
        assert "exited 1" in warning

    def test_no_pdf_raises_with_classified_message(self):
        fake = FakeRun(xelatex_rcs=(1, 1), pdf_bytes=None, log_text=ERROR_LOG)
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError, match="Undefined control sequence"):
                convert_to_pdf(md_path)

    def test_empty_pdf_is_fatal(self):
        # A 0-byte PDF is never usable, and _require_nonempty would reject it anyway.
        fake = FakeRun(xelatex_rcs=(1, 1), pdf_bytes=b"", log_text=ERROR_LOG)
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError):
                convert_to_pdf(md_path)

    def test_hard_failure_carries_the_generated_tex(self):
        fake = FakeRun(xelatex_rcs=(1, 1), pdf_bytes=None, log_text=ERROR_LOG)
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError) as exc:
                convert_to_pdf(md_path)
        # The .tex dies with the build dir, so the exception is what carries it out.
        assert exc.value.tex_source == fake.tex_text

    def test_pandoc_failure_raises_before_any_xelatex_run(self):
        fake = FakeRun(pandoc_rc=1, pandoc_stderr="template not found")
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError, match="template not found"):
                convert_to_pdf(md_path)
        assert fake.xelatex_cmds == []

    def test_pandoc_failure_with_tex_error_is_classified(self):
        fake = FakeRun(pandoc_rc=1, pandoc_stderr=ERROR_LOG)
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError, match="Undefined control sequence"):
                convert_to_pdf(md_path)

    def test_pandoc_failure_message_is_truncated(self):
        # It reaches the user as a toast, so the unclassifiable case keeps the tail only.
        fake = FakeRun(pandoc_rc=1, pandoc_stderr="x" * 10_000)
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError) as exc:
                convert_to_pdf(md_path)
        assert len(str(exc.value)) < 10_000
        assert str(exc.value).count("x") == 2000


class TestToolTimeout:
    """A wedged tool would hold the caller's per-lecture lock forever, so it is bounded
    and surfaces as an ordinary render failure."""

    def test_pandoc_hang_raises_before_any_xelatex_run(self):
        fake = FakeRun(hangs=("pandoc",))
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError, match="pandoc timed out after 60s"):
                convert_to_pdf(md_path)
        assert fake.xelatex_cmds == []

    def test_first_pass_hang_raises_and_carries_the_generated_tex(self):
        fake = FakeRun(hangs=("xelatex",))
        with _render(fake) as md_path:
            with pytest.raises(
                PdfRenderError, match="xelatex timed out after 60s"
            ) as e:
                convert_to_pdf(md_path)
        # pandoc already produced the .tex, so a timeout keeps it debuggable like any
        # other hard failure.
        assert e.value.tex_source == fake.tex_text

    def test_second_pass_hang_keeps_pass_1s_pdf_and_warns(self):
        """Pass 1's PDF is usable and only its references are stale — but pass 2 has
        already overwritten it on disk, so the salvage must return the saved copy."""

        fake = FakeRun(hangs=("xelatex:2",))
        with _render(fake) as md_path:
            pdf_path, warning = convert_to_pdf(md_path)
            assert Path(pdf_path).read_bytes() == b"%PDF-1.4 stub"
        assert warning == "xelatex timed out after 60s"

    def test_second_pass_hang_still_reports_a_tex_error_from_pass_1s_log(self):
        # Pass 2 truncated the log too, so the errors have to come from pass 1's copy.
        fake = FakeRun(hangs=("xelatex:2",), log_text=ERROR_LOG)
        with _render(fake) as md_path:
            _, warning = convert_to_pdf(md_path)
        assert warning == r"LaTeX error: Undefined control sequence (line 417: \Pi)"

    def test_second_pass_hang_with_no_pass_1_pdf_is_fatal(self):
        # Nothing to salvage: pass 2's truncated fragment must not be promoted as the PDF.
        fake = FakeRun(hangs=("xelatex:2",), pdf_bytes=None)
        with _render(fake) as md_path:
            with pytest.raises(PdfRenderError, match="no usable PDF"):
                convert_to_pdf(md_path)

    def test_every_tool_call_is_bounded(self):
        # pandoc + both xelatex passes — no unbounded call may slip back in.
        fake = FakeRun()
        timeouts = []

        def spy(cmd, **kwargs):
            timeouts.append(kwargs.get("timeout"))
            return fake(cmd, **kwargs)

        with tempfile.TemporaryDirectory() as d:
            md_path = Path(d) / "summary.md"
            md_path.write_text("שלום world\n", encoding="utf-8")
            with patch("subprocess.run", spy):
                convert_to_pdf(str(md_path))
        assert timeouts == [60, 60, 60]
