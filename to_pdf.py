#!/usr/bin/env python3
"""Convert a Markdown summary file to PDF with Hebrew/RTL support and math rendering."""

import subprocess
import sys
import tempfile
from pathlib import Path

FONTS_DIR = Path(__file__).parent / "fonts"
HEBREW_FONT = FONTS_DIR / "NotoSansHebrew-Regular.ttf"

LATEX_HEADER = r"""
\usepackage{fontspec}
\setmainfont[Path=FONTS_DIR_PLACEHOLDER,Extension=.ttf]{NotoSansHebrew-Regular}
\usepackage{bidi}
\setRTL
"""


def convert_to_pdf(md_path: str) -> str:
    input_path = Path(md_path)
    if not input_path.exists():
        raise FileNotFoundError(f"File not found: {md_path}")
    if not HEBREW_FONT.exists():
        raise FileNotFoundError(f"Font not found: {HEBREW_FONT}")

    output_path = input_path.with_suffix(".pdf")
    fonts_dir = str(FONTS_DIR) + "/"
    header = LATEX_HEADER.replace("FONTS_DIR_PLACEHOLDER", fonts_dir)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".tex", delete=False) as f:
        f.write(header)
        header_path = f.name

    cmd = [
        "pandoc", str(input_path),
        "-o", str(output_path),
        "--pdf-engine=xelatex",
        "-V", "geometry:margin=2.5cm",
        "-V", "linestretch=1.3",
        f"--include-in-header={header_path}",
        "--standalone",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    Path(header_path).unlink(missing_ok=True)

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
