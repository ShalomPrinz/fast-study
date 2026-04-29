#!/usr/bin/env python3
"""Convert a Markdown summary file to PDF with Hebrew/RTL support and math rendering."""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

FONTS_DIR = Path(__file__).parent / "fonts"
HEBREW_FONT = FONTS_DIR / "NotoSansHebrew-Regular.ttf"

LATEX_HEADER = r"""
\usepackage{polyglossia}
\setmainlanguage{hebrew}
\setotherlanguage{english}
\newfontfamily\hebrewfont{Noto Sans Hebrew}[Script=Hebrew]
\newfontfamily\hebrewfontsf{Noto Sans Hebrew}[Script=Hebrew]
\newfontfamily\hebrewfonttt{Noto Sans Hebrew}[Script=Hebrew]
\newfontfamily\englishfont{Noto Sans Hebrew}
\newfontfamily\englishfontsf{Noto Sans Hebrew}
\newfontfamily\englishfonttt{Noto Sans Mono}
"""


LIST_ITEM_RE = re.compile(r'^(\s*(?:-|\d+\.)\s)')
# Matches 2+ consecutive Latin words (with optional digits/hyphens) separated by spaces.
# Single Latin words form their own LTR run naturally; only multi-word runs reverse.
MULTI_LATIN_RE = re.compile(r'([A-Za-z][A-Za-z0-9\-]*(?:[ \t]+[A-Za-z][A-Za-z0-9\-]*)+)')


def wrap_english_phrases(text: str) -> str:
    """Wrap multi-word Latin runs in \\LR{} so bidi doesn't reverse word order."""
    result = []
    for line in text.splitlines(keepends=True):
        # Split on code spans to avoid touching backtick-enclosed content
        parts = re.split(r'(`[^`]*`)', line)
        out = []
        for i, part in enumerate(parts):
            if i % 2 == 1:  # inside a code span — leave untouched
                out.append(part)
            else:
                out.append(MULTI_LATIN_RE.sub(r'\\LR{\1}', part))
        result.append(''.join(out))
    return ''.join(result)


def ensure_blank_before_lists(text: str) -> str:
    lines = text.splitlines(keepends=True)
    result = []
    for i, line in enumerate(lines):
        if i > 0 and LIST_ITEM_RE.match(line):
            prev = lines[i - 1]
            if prev.strip() and not LIST_ITEM_RE.match(prev):
                result.append('\n')
        result.append(line)
    return ''.join(result)


def convert_to_pdf(md_path: str) -> str:
    input_path = Path(md_path)
    if not input_path.exists():
        raise FileNotFoundError(f"File not found: {md_path}")
    if not HEBREW_FONT.exists():
        raise FileNotFoundError(f"Font not found: {HEBREW_FONT}")

    output_path = input_path.with_suffix(".pdf")
    fonts_dir = str(FONTS_DIR) + "/"
    header = LATEX_HEADER.replace("FONTS_DIR_PLACEHOLDER", fonts_dir)

    raw_md = input_path.read_text(encoding="utf-8")
    fixed_md = wrap_english_phrases(ensure_blank_before_lists(raw_md))

    with tempfile.NamedTemporaryFile(mode="w", suffix=".tex", delete=False) as f:
        f.write(header)
        header_path = f.name

    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(fixed_md)
        md_temp_path = f.name

    template_path = Path(__file__).parent / "pandoc_template.tex"

    cmd = [
        "pandoc", md_temp_path,
        "-o", str(output_path),
        "--pdf-engine=xelatex",
        f"--template={template_path}",
        "-V", "geometry:margin=2.5cm",
        "-V", "linestretch=1.3",
        f"--include-in-header={header_path}",
        "--standalone",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    Path(header_path).unlink(missing_ok=True)
    Path(md_temp_path).unlink(missing_ok=True)

    if result.returncode != 0:
        raise RuntimeError(f"pandoc failed:\n{result.stderr}")

    return str(output_path)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 to_pdf.py <summary.md>")
        sys.exit(1)

    try:
        output = convert_to_pdf(sys.argv[1])
        print(f"PDF created: {output}")
    except (FileNotFoundError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
