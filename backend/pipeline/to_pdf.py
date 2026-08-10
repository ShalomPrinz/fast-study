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
LTR_CODE_FILTER = Path(__file__).parent.parent / "assets" / "filters" / "ltr_code.lua"

LATEX_HEADER = r"""
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
    if not LTR_CODE_FILTER.exists():
        raise FileNotFoundError(f"Lua filter not found: {LTR_CODE_FILTER}")

    output_path = input_path.with_suffix(".pdf")
    fonts_dir = str(FONTS_DIR) + "/"
    header = LATEX_HEADER.replace("FONTS_DIR_PLACEHOLDER", fonts_dir)

    raw_md = input_path.read_text(encoding="utf-8")

    def preprocess(t: str) -> str:
        t = close_unbalanced_display_math(t)
        t = normalize_dashes(t)
        t = unwrap_math_code(t)
        t = demote_math_identifier(t)
        t = unwrap_math_text_macros(t)
        t = normalize_math_text_spaces(t)
        t = wrap_math_text_dir(t)
        t = normalize_math_spans(t)
        t = ensure_blank_before_lists(t)
        t = wrap_english_phrases(t)
        t = force_ltr_inline_code(t)
        t = merge_rtl_math_number(t)
        t = merge_ltr_math(t)
        return t

    fixed_md = apply_outside_fences(raw_md, preprocess)

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
            f"--lua-filter={LTR_CODE_FILTER}",
            "--standalone",
        ]
        result = subprocess.run(
            pandoc_cmd, capture_output=True, text=True, cwd=build_dir
        )
        if result.returncode != 0:
            # pandoc relays errors on either stream; with no `! …` at all the failure is
            # pandoc's own (bad markdown, missing template) and keeps the full log.
            raise PdfRenderError(
                classify(
                    f"{result.stdout}\n{result.stderr}",
                    f"pandoc failed:\n{result.stderr}",
                )
            )

        tex_path = build / f"{BUILD_STEM}.tex"
        tex_source = tex_path.read_text(encoding="utf-8", errors="replace")

        # Twice: hyperref/bookmark need a second pass for stable references — this is
        # what pandoc's own engine loop did. nonstopmode keeps going past errors, so a
        # damaged region degrades to a wrong/blank page instead of killing the render.
        returncodes = []
        for _ in range(2):
            run = subprocess.run(
                ["xelatex", "-interaction=nonstopmode", f"{BUILD_STEM}.tex"],
                capture_output=True,
                text=True,
                cwd=build_dir,
            )
            returncodes.append(run.returncode)

        log_path = build / f"{BUILD_STEM}.log"
        log_text = (
            log_path.read_text(encoding="utf-8", errors="replace")
            if log_path.exists()
            else ""
        )
        # The .log is the full record and xelatex's stdout mirrors it — classifying both
        # would count every error twice, so stdout is only the fallback when no log exists.
        combined = log_text or run.stdout

        built_pdf = build / f"{BUILD_STEM}.pdf"
        if not built_pdf.exists() or built_pdf.stat().st_size == 0:
            raise PdfRenderError(
                classify(
                    combined,
                    f"xelatex produced no usable PDF:\n{combined[-_LOG_TAIL_CHARS:]}",
                ),
                tex_source=tex_source,
            )

        # XeLaTeX names its output after the .tex stem, so move it onto the caller's path.
        shutil.move(str(built_pdf), str(output_path))

        if all(rc == 0 for rc in returncodes):
            return str(output_path), None
        # Non-zero but a usable PDF came out: accept it and report the errors as a warning.
        return str(output_path), classify(
            combined, f"xelatex exited {returncodes[-1]} with no reported error"
        )
