import shutil
import subprocess
import tempfile
from pathlib import Path

from timing import timed_pipeline

from pipeline.pdf.bidi import force_ltr_inline_code, wrap_english_phrases
from pipeline.pdf.math_fixes import (
    close_unbalanced_display_math,
    demote_math_identifier,
    merge_ltr_math,
    merge_rtl_math_number,
    normalize_math_spans,
    normalize_math_text_spaces,
    unwrap_math_code,
    unwrap_math_text_macros,
    wrap_math_text_dir,
)
from pipeline.pdf.tex_errors import classify
from pipeline.pdf.text import (
    apply_outside_fences,
    ensure_blank_before_lists,
    normalize_dashes,
)

FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
HEBREW_FONT = FONTS_DIR / "NotoSansHebrew-Regular.ttf"
HEBREW_FONT_BOLD = FONTS_DIR / "NotoSansHebrew-Bold.ttf"
DIRECTION_FILTER = (
    Path(__file__).parent.parent / "assets" / "filters" / "text_direction.lua"
)

# Preamble pandoc injects via --include-in-header. Package order and the callout box
# design are load-bearing — see docs/PDF.md.
LATEX_HEADER = r"""
\usepackage{tcolorbox}
\definecolor{calloutDefinitionTint}{HTML}{EDF3F9}
\definecolor{calloutDefinitionFrame}{HTML}{1F4E79}
\definecolor{calloutWarningTint}{HTML}{FBF2E3}
\definecolor{calloutWarningFrame}{HTML}{B8860B}
\definecolor{calloutInsightTint}{HTML}{EBF4F0}
\definecolor{calloutInsightFrame}{HTML}{2E7D6B}
\tcbset{calloutstyle/.style={boxrule=0.7pt, arc=2pt, left=8pt, right=8pt, top=6pt, bottom=6pt, before skip=8pt, after skip=8pt}}
\newtcolorbox{calloutdefinition}{calloutstyle, colback=calloutDefinitionTint, colframe=calloutDefinitionFrame}
\newtcolorbox{calloutwarning}{calloutstyle, colback=calloutWarningTint, colframe=calloutWarningFrame}
\newtcolorbox{calloutinsight}{calloutstyle, colback=calloutInsightTint, colframe=calloutInsightFrame}

\usepackage{polyglossia}
\setmainlanguage{hebrew}
\setotherlanguage{english}
\newfontfamily\hebrewfont{NotoSansHebrew-Regular}[Script=Hebrew, Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\hebrewfontsf{NotoSansHebrew-Regular}[Script=Hebrew, Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\hebrewfonttt{NotoSansHebrew-Regular}[Script=Hebrew, Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\englishfont{NotoSansHebrew-Regular}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\englishfontsf{NotoSansHebrew-Regular}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\englishfonttt{MiriamMonoCLM-Book}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=MiriamMonoCLM-Bold]
\setmonofont{MiriamMonoCLM-Book}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=MiriamMonoCLM-Bold]
"""


class PdfRenderError(RuntimeError):
    """A render that produced no usable PDF. Carries the generated .tex source so the
    caller — which owns the lecture identity this module must not know — can persist it."""

    def __init__(self, message: str, tex_source: str | None = None):
        super().__init__(message)
        self.tex_source = tex_source


BUILD_STEM = "build"  # XeLaTeX names its outputs after the .tex stem
_LOG_TAIL_CHARS = 2000
# A render is seconds, so a minute is already wedged. Bounded because the caller holds a
# per-lecture lock across it — a hang would leave that lecture permanently `busy`.
_TOOL_TIMEOUT_SECONDS = 60


def _run_tool(
    cmd: list[str],
    cwd: str,
    tex_source: str | None = None,
    timeout: int = _TOOL_TIMEOUT_SECONDS,
):
    """Run one build tool in `cwd`, converting a hang into a normal render failure."""

    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise PdfRenderError(
            f"{cmd[0]} timed out after {timeout}s", tex_source
        ) from None


def _read_log(build: Path) -> str:
    """The build log as it stands right now — each xelatex pass rewrites it from scratch."""

    log_path = build / f"{BUILD_STEM}.log"
    return (
        log_path.read_text(encoding="utf-8", errors="replace")
        if log_path.exists()
        else ""
    )


def _run_xelatex_passes(
    build: Path, tex_source: str
) -> tuple[list[int], str | None, str]:
    """Run both xelatex passes over build.tex, leaving the PDF to render at build.pdf.
    Returns (per-pass return codes, pass-2 timeout message or None, text to classify)."""

    # Twice: hyperref/bookmark need a second pass for stable references. nonstopmode keeps
    # going past errors, so a damaged region degrades to a bad page, not a failed render.
    built_pdf = build / f"{BUILD_STEM}.pdf"
    pass1_pdf = build / f"{BUILD_STEM}.pass1.pdf"
    pass1_log = ""
    returncodes: list[int] = []
    pass2_timeout = None
    for attempt in range(2):
        try:
            run = _run_tool(
                ["xelatex", "-interaction=nonstopmode", f"{BUILD_STEM}.tex"],
                str(build),
                tex_source,
            )
        except PdfRenderError as e:
            # A pass-1 timeout leaves no PDF to salvage. Pass 2 only stabilizes
            # references, so its timeout degrades like any other recoverable error.
            if attempt == 0:
                raise
            pass2_timeout = str(e)
            break
        returncodes.append(run.returncode)
        if attempt == 0:
            # Pass 2 truncates build.pdf/.log and rewrites them from its first \shipout, so
            # a killed one leaves a fragment. Keep pass 1's files — that is what's salvaged.
            pass1_log = _read_log(build)
            if built_pdf.exists():
                shutil.copy2(built_pdf, pass1_pdf)

    if pass2_timeout:
        built_pdf.unlink(missing_ok=True)
        if pass1_pdf.exists():
            pass1_pdf.replace(built_pdf)

    # The .log is the full record and xelatex's stdout mirrors it — classifying both
    # would count every error twice, so stdout is only the fallback when no log exists.
    combined = (pass1_log if pass2_timeout else _read_log(build)) or run.stdout
    return returncodes, pass2_timeout, combined


def preprocess_markdown(text: str) -> str:
    """The prose fix chain, in order. Runs via `apply_outside_fences`, so it never sees a
    fenced code block or a `::: callout` marker line. Order matters — see docs/PDF.md."""

    text = close_unbalanced_display_math(text)
    text = normalize_dashes(text)
    text = unwrap_math_code(text)
    text = demote_math_identifier(text)
    text = unwrap_math_text_macros(text)
    text = normalize_math_text_spaces(text)
    text = wrap_math_text_dir(text)
    text = normalize_math_spans(text)
    text = ensure_blank_before_lists(text)
    text = wrap_english_phrases(text)
    text = force_ltr_inline_code(text)
    text = merge_rtl_math_number(text)
    text = merge_ltr_math(text)
    return text


@timed_pipeline("pdf")
def convert_to_pdf(md_path: str) -> tuple[str, str | None]:
    """Preprocess a markdown file and render it to a PDF beside it in two passes:
    pandoc → .tex, then xelatex. Returns (pdf path, non-fatal warning or None)."""

    input_path = Path(md_path)
    if not input_path.exists():
        raise FileNotFoundError(f"File not found: {md_path}")
    if not HEBREW_FONT.exists():
        raise FileNotFoundError(f"Font not found: {HEBREW_FONT}")
    if not HEBREW_FONT_BOLD.exists():
        raise FileNotFoundError(f"Font not found: {HEBREW_FONT_BOLD}")
    if not DIRECTION_FILTER.exists():
        raise FileNotFoundError(f"Lua filter not found: {DIRECTION_FILTER}")

    output_path = input_path.with_suffix(".pdf")
    fonts_dir = str(FONTS_DIR) + "/"
    header = LATEX_HEADER.replace("FONTS_DIR_PLACEHOLDER", fonts_dir)

    raw_md = input_path.read_text(encoding="utf-8")
    fixed_md = apply_outside_fences(raw_md, preprocess_markdown)

    template_path = (
        Path(__file__).parent.parent / "assets" / "templates" / "pandoc_template.tex"
    )

    # Everything the build touches lives in one tempdir: pandoc's inputs, the generated
    # .tex, and XeLaTeX's aux files (it writes them beside the .tex, i.e. into the cwd).
    with tempfile.TemporaryDirectory() as build_dir:
        build = Path(build_dir)
        header_path = build / "header.tex"
        header_path.write_text(header, encoding="utf-8")
        md_temp_path = build / "input.md"
        md_temp_path.write_text(fixed_md, encoding="utf-8")

        pandoc_cmd = [
            "pandoc",
            str(md_temp_path),
            "-o",
            f"{BUILD_STEM}.tex",
            "--from=markdown-smart",
            f"--template={template_path}",
            "-V",
            "geometry:margin=2.5cm",
            "-V",
            "linestretch=1.3",
            f"--include-in-header={header_path}",
            f"--lua-filter={DIRECTION_FILTER}",
            "--standalone",
        ]
        result = _run_tool(pandoc_cmd, build_dir)
        if result.returncode != 0:
            # pandoc relays errors on either stream; with no `! …` at all the failure is
            # pandoc's own and falls back to the stream TAIL, since this reaches a toast.
            raise PdfRenderError(
                classify(
                    f"{result.stdout}\n{result.stderr}",
                    f"pandoc failed:\n{result.stderr[-_LOG_TAIL_CHARS:]}",
                )
            )

        tex_path = build / f"{BUILD_STEM}.tex"
        tex_source = tex_path.read_text(encoding="utf-8", errors="replace")

        returncodes, pass2_timeout, combined = _run_xelatex_passes(build, tex_source)

        built_pdf = build / f"{BUILD_STEM}.pdf"
        if not built_pdf.exists() or built_pdf.stat().st_size == 0:
            raise PdfRenderError(
                classify(
                    combined,
                    f"xelatex produced no usable PDF:\n{combined[-_LOG_TAIL_CHARS:]}",
                ),
                tex_source=tex_source,
            )

        shutil.move(str(built_pdf), str(output_path))

        if pass2_timeout:
            # Errors already in the log are the more actionable half of this warning.
            return str(output_path), classify(combined, pass2_timeout)
        if all(rc == 0 for rc in returncodes):
            return str(output_path), None
        # Non-zero but a usable PDF came out: accept it and report the errors as a warning.
        return str(output_path), classify(
            combined, f"xelatex exited {returncodes[-1]} with no reported error"
        )
