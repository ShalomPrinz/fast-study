import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

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

FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
HEBREW_FONT = FONTS_DIR / "NotoSansHebrew-Regular.ttf"
HEBREW_FONT_BOLD = FONTS_DIR / "NotoSansHebrew-Bold.ttf"
DIRECTION_FILTER = (
    Path(__file__).parent.parent / "assets" / "filters" / "text_direction.lua"
)

# The fonts are copied into the build directory and referenced relatively, never by absolute path.
# fontspec folds `Path=` and the font name into one bracketed XeTeX spec — `[C:/…/Font.ttf]/OT` —
# which tectonic hands to Win32 as a filename; with `C:` out of drive position Windows rejects it
# (os error 123), and with the backslashes verbatim it dies earlier still, on `\Users` read as a
# control sequence. `./` is the same string on both platforms and under either engine.
BUILD_FONTS_PATH = "./"

# Preamble pandoc injects via --include-in-header. Package order and the callout box
# design are load-bearing — see docs/PDF.md.
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


class PdfRenderError(RuntimeError):
    """A render that produced no usable PDF. Carries the generated .tex source so the
    caller — which owns the lecture identity this module must not know — can persist it."""

    def __init__(self, message: str, tex_source: str | None = None):
        super().__init__(message)
        self.tex_source = tex_source


BUILD_STEM = "build"  # the engine names its outputs after the .tex stem
_LOG_TAIL_CHARS = 2000

# Tectonic's own diagnostics, which go to stderr while `note:` goes to stdout. Extracted by
# pattern rather than tailed: a failed run can emit a thousand `Missing character` warnings, so a
# tail buries the one line that says what actually went wrong.
_TECTONIC_ERROR_RE = re.compile(r"^error:.*$", re.MULTILINE)

# Two concurrent first-ever renders each build the format into a temp file and rename it onto the
# final name. On Windows the loser hits the winner's open handle. The rename is atomic, so the
# surviving .fmt is never corrupt and a single retry runs warm.
_FORMAT_RACE_MARKER = "failed to persist temporary file"

# A font the engine cannot load is dropped glyph by glyph: the render exits 0 and writes a
# plausible PDF with characters silently absent. TeX reports it as `! Font …`.
_FONT_ERROR_PREFIX = "Font "

# A render is seconds against a complete cache, so a minute is already wedged. Bounded because the
# caller holds a per-lecture lock across it — a hang would leave that lecture permanently `busy`.
_TOOL_TIMEOUT_SECONDS = 60
# A dev cache starts empty and the first render fetches the LaTeX bundle over the network, which
# is minutes and happens once per machine. The packaged app never reaches this: its cache ships
# complete and `--only-cached` forbids the fetch outright.
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
    # Replaces xelatex's -interaction=nonstopmode. Without it a recoverable error yields no PDF at
    # all; with it the run exits 0 having written a degraded one, which is why the warning below
    # is read out of the log and never off the return code.
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
        raise PdfRenderError(
            f"{Path(cmd[0]).stem} timed out after {timeout}s", tex_source
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
    """Tectonic's `error:` lines, joined. Non-empty stderr is not failure on either platform —
    Windows emits a Fontconfig complaint on every run and Linux several `warning:` lines even on
    a clean one — so only `error:` is kept."""

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
    pandoc → .tex, then tectonic. Returns (pdf path, non-fatal warning or None)."""

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
    header = LATEX_HEADER.replace("FONTS_DIR_PLACEHOLDER", BUILD_FONTS_PATH)

    raw_md = input_path.read_text(encoding="utf-8")
    fixed_md = apply_outside_fences(raw_md, preprocess_markdown)

    template_path = (
        Path(__file__).parent.parent / "assets" / "templates" / "pandoc_template.tex"
    )

    # Everything the build touches lives in one tempdir: pandoc's inputs, the fonts, the generated
    # .tex, and the engine's aux files (it writes them beside the .tex, i.e. into the cwd).
    with tempfile.TemporaryDirectory() as build_dir:
        build = Path(build_dir)
        for font in FONTS_DIR.glob("*.ttf"):
            shutil.copy2(font, build / font.name)
        header_path = build / "header.tex"
        header_path.write_text(header, encoding="utf-8")
        md_temp_path = build / "input.md"
        md_temp_path.write_text(fixed_md, encoding="utf-8")

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

        run = _render(build, tex_source)
        log = _read_log(build)
        engine_errors = _tectonic_errors(run.stderr)

        built_pdf = build / f"{BUILD_STEM}.pdf"
        if not built_pdf.exists() or built_pdf.stat().st_size == 0:
            # An unrecoverable font failure writes a log with zero `!` lines that ends "Output
            # written on build.xdv" — it reads like success — and a cold-cache panic writes no log
            # at all. Both name their cause only on stderr, so that is the fallback.
            raise PdfRenderError(
                classify(
                    log,
                    f"tectonic produced no usable PDF:\n"
                    f"{engine_errors or log[-_LOG_TAIL_CHARS:]}",
                ),
                tex_source=tex_source,
            )

        errors = parse_tex_errors(log)
        font_errors = [e for e in errors if e.message.startswith(_FONT_ERROR_PREFIX)]
        if font_errors:
            # The one damage a reader cannot see: the page is intact, the sentence reads, and only
            # the symbol it was about is gone. Refused rather than shipped with a warning.
            raise PdfRenderError(
                f"missing font, characters would be dropped — "
                f"{format_tex_errors(font_errors)}",
                tex_source=tex_source,
            )

        shutil.move(str(built_pdf), str(output_path))

        if errors:
            # -Z continue-on-errors makes a run that errored still exit 0, so the log is what says
            # a page came out damaged. The return code would drop the warning on every run it
            # exists for.
            return str(output_path), format_tex_errors(errors)
        if run.returncode != 0:
            return str(output_path), (
                engine_errors or f"tectonic exited {run.returncode} with no reported error"
            )
        return str(output_path), None
