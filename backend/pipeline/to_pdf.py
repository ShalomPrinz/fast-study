import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from services.errors import CodedError
from services.resources import resource_path
from timing import timed_pipeline
from tools import tool_path

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
from pipeline.pdf.tex_errors import classify, format_tex_errors, parse_tex_errors
from pipeline.pdf.text import (
    apply_outside_fences,
    ensure_blank_before_lists,
    normalize_dashes,
)

FONTS_DIR = resource_path("assets", "fonts")
HEBREW_FONT = FONTS_DIR / "NotoSansHebrew-Regular.ttf"
HEBREW_FONT_BOLD = FONTS_DIR / "NotoSansHebrew-Bold.ttf"
DIRECTION_FILTER = resource_path("assets", "filters", "text_direction.lua")

# Fonts are copied into the build dir and referenced relatively — an absolute path breaks on
# Windows. See docs/PDF.md.
BUILD_FONTS_PATH = "./"

# Preamble pandoc injects via --include-in-header. Package order and the callout box
# design are load-bearing — see docs/BIDI.md.
LATEX_HEADER = r"""
\usepackage{fvextra}
\fvset{breaklines=true, breakanywhere=true, breakautoindent=true, breaksymbolleft={}, breaksymbolright={}, breakanywheresymbolpre={}}

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


class PdfRenderError(CodedError):
    """A render that produced no usable PDF. Carries the generated .tex source so the
    caller — which owns the lecture identity this module must not know — can persist it."""

    def __init__(
        self,
        message: str,
        code: str,
        params: dict | None = None,
        tex_source: str | None = None,
    ):
        super().__init__(message, code, **(params or {}))
        self.tex_source = tex_source


BUILD_STEM = "build"  # the engine names its outputs after the .tex stem
_LOG_TAIL_CHARS = 2000

# Tectonic's own stderr diagnostics, extracted rather than tailed: a failed run can emit a
# thousand `Missing character` lines that bury the one that matters.
_TECTONIC_ERROR_RE = re.compile(r"^error:.*$", re.MULTILINE)

# Two concurrent first-ever renders race to rename the built format; on Windows the loser hits
# the winner's open handle. The rename is atomic, so one retry runs warm.
_FORMAT_RACE_MARKER = "failed to persist temporary file"

# A font the engine cannot load is dropped glyph by glyph: the render exits 0 and writes a
# plausible PDF with characters silently absent. TeX reports it as `! Font …`.
_FONT_ERROR_PREFIX = "Font "

# A render is seconds against a complete cache, so a minute is already wedged. Bounded because the
# caller holds a per-lecture lock across it — a hang would leave that lecture permanently `busy`.
_TOOL_TIMEOUT_SECONDS = 60
# A dev cache starts empty and the first render fetches the LaTeX bundle — minutes, once per
# machine. The packaged app never reaches this; its cache ships complete.
_COLD_CACHE_TIMEOUT_SECONDS = 900


def _cache_is_frozen() -> bool:
    """Whether the LaTeX cache is the shipped, complete one. `TECTONIC_CACHE_DIR` is set only by
    the launcher, pointing at the read-only `bundles/` the build primed."""

    return bool(os.environ.get("TECTONIC_CACHE_DIR"))


def _tectonic_cmd() -> list[str]:
    """The one render invocation. Tectonic runs to convergence itself, so there is no second pass."""

    cmd = [tool_path("tectonic")]
    # Without --keep-logs tectonic discards build.log as an intermediate, and the log is where
    # every recoverable error and every missing font is reported.
    cmd.append("--keep-logs")
    if _cache_is_frozen():
        # The shipped app must never fetch mid-render; a gap in the cache has to fail loudly here
        # rather than hang on a network the user may not have.
        cmd.append("--only-cached")
    # Without it a recoverable error yields no PDF; with it the run exits 0 on a degraded one,
    # so the warning is read from the log, never the return code.
    cmd += ["-Z", "continue-on-errors", f"{BUILD_STEM}.tex"]
    return cmd


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
            encoding="utf-8",  # default is OS locale codepage so force UTF-8
            errors="replace",
            cwd=cwd,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        tool = Path(cmd[0]).stem
        raise PdfRenderError(
            f"{tool} timed out after {timeout}s",
            "pdf_tool_timeout",
            {"tool": tool, "seconds": timeout},
            tex_source,
        ) from None


def _read_log(build: Path) -> str:
    """The build log as it stands right now — every run rewrites it from scratch."""

    log_path = build / f"{BUILD_STEM}.log"
    return (
        log_path.read_text(encoding="utf-8", errors="replace")
        if log_path.exists()
        else ""
    )


def _tectonic_errors(stderr: str) -> str:
    """Tectonic's `error:` lines, joined. Non-empty stderr is not failure on either platform, so
    only `error:` is kept."""

    return "\n".join(m.group(0) for m in _TECTONIC_ERROR_RE.finditer(stderr))


def _render(build: Path, tex_source: str):
    """Render build.tex to build.pdf, retrying once if this machine lost the format-build race."""

    timeout = (
        _TOOL_TIMEOUT_SECONDS if _cache_is_frozen() else _COLD_CACHE_TIMEOUT_SECONDS
    )
    run = _run_tool(_tectonic_cmd(), str(build), tex_source, timeout=timeout)
    if _FORMAT_RACE_MARKER in run.stderr:
        # Only a machine's first-ever render can lose it, and the winner's .fmt is in place now.
        run = _run_tool(_tectonic_cmd(), str(build), tex_source, timeout=timeout)
    return run


def preprocess_markdown(text: str) -> str:
    """The prose fix chain, in order. Runs via `apply_outside_fences`, so it never sees a
    fenced code block or a `::: callout` marker line. Order matters — see docs/BIDI.md."""

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


def build_tex(markdown: str, build: Path) -> str:
    """Populate `build` with the fonts, header and input, run pandoc, and return build.tex's
    source. The markdown must already be pandoc-ready — the caller owns preprocessing."""

    for label, asset in (
        ("Font", HEBREW_FONT),
        ("Font", HEBREW_FONT_BOLD),
        ("Lua filter", DIRECTION_FILTER),
    ):
        if not asset.exists():
            raise PdfRenderError(
                f"{label} not found: {asset}",
                "pdf_asset_missing",
                {"asset": asset.name},
            )

    template_path = resource_path("assets", "templates", "pandoc_template.tex")
    header = LATEX_HEADER.replace("FONTS_DIR_PLACEHOLDER", BUILD_FONTS_PATH)

    for font in FONTS_DIR.glob("*.ttf"):
        shutil.copy2(font, build / font.name)
    header_path = build / "header.tex"
    header_path.write_text(header, encoding="utf-8")
    md_temp_path = build / "input.md"
    md_temp_path.write_text(markdown, encoding="utf-8")

    pandoc_cmd = [
        tool_path("pandoc"),
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
    result = _run_tool(pandoc_cmd, str(build))
    if result.returncode != 0:
        # pandoc relays errors on either stream; with no `! …` at all the failure is
        # pandoc's own and falls back to the stream TAIL, since this reaches a toast.
        tail = result.stderr[-_LOG_TAIL_CHARS:]
        message, code, params = classify(
            f"{result.stdout}\n{result.stderr}",
            f"pandoc failed:\n{tail}",
            "pdf_pandoc_failed",
            detail=tail,
        )
        raise PdfRenderError(message, code, params)

    tex_path = build / f"{BUILD_STEM}.tex"
    return tex_path.read_text(encoding="utf-8", errors="replace")


@timed_pipeline("pdf")
def convert_to_pdf(md_path: str) -> tuple[str, str | None]:
    """Preprocess a markdown file and render it to a PDF beside it in two passes:
    pandoc → .tex, then tectonic. Returns (pdf path, non-fatal warning or None)."""

    input_path = Path(md_path)
    if not input_path.exists():
        raise PdfRenderError(
            f"File not found: {md_path}",
            "internal_missing_input",
            {"file": input_path.name},
        )

    output_path = input_path.with_suffix(".pdf")

    raw_md = input_path.read_text(encoding="utf-8")
    fixed_md = apply_outside_fences(raw_md, preprocess_markdown)

    # Everything the build touches lives in one tempdir: pandoc's inputs, the fonts, the generated
    # .tex, and the engine's aux files (it writes them beside the .tex, i.e. into the cwd).
    with tempfile.TemporaryDirectory() as build_dir:
        build = Path(build_dir)
        tex_source = build_tex(fixed_md, build)

        run = _render(build, tex_source)
        log = _read_log(build)
        engine_errors = _tectonic_errors(run.stderr)

        built_pdf = build / f"{BUILD_STEM}.pdf"
        if not built_pdf.exists() or built_pdf.stat().st_size == 0:
            # A font failure's log reads like success and a cold-cache panic writes none; both
            # name their cause only on stderr.
            detail = engine_errors or log[-_LOG_TAIL_CHARS:]
            message, code, params = classify(
                log,
                f"tectonic produced no usable PDF:\n{detail}",
                "pdf_engine_no_output",
                detail=detail,
            )
            raise PdfRenderError(message, code, params, tex_source=tex_source)

        errors = parse_tex_errors(log)
        font_errors = [e for e in errors if e.message.startswith(_FONT_ERROR_PREFIX)]
        if font_errors:
            # The one damage a reader cannot see: the page is intact, the sentence reads, and only
            # the symbol it was about is gone. Refused rather than shipped with a warning.
            raise PdfRenderError(
                f"missing font, characters would be dropped — "
                f"{format_tex_errors(font_errors)}",
                "pdf_missing_font",
                {"detail": font_errors[0].message},
                tex_source=tex_source,
            )

        shutil.move(str(built_pdf), str(output_path))

        if errors:
            # -Z continue-on-errors exits 0 on an errored run, so only the log says a page came
            # out damaged.
            return str(output_path), format_tex_errors(errors)
        if run.returncode != 0:
            return str(output_path), (
                engine_errors
                or f"tectonic exited {run.returncode} with no reported error"
            )
        return str(output_path), None
