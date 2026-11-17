"""Re-render a summary.md with the current backend code into <out_dir>: summary.md, summary.pdf, build.tex, warning.txt.

Usage (from backend/): uv run python ../.claude/skills/pdf-debug/scripts/rerender.py <summary.md> <out_dir>
"""

import shutil
import sys
import tempfile
from pathlib import Path

from pipeline.pdf.text import apply_outside_fences
from pipeline.to_pdf import build_tex, convert_to_pdf, preprocess_markdown

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
md = out / "summary.md"
shutil.copy2(src, md)
if (src.parent / "figures").is_dir():
    shutil.copytree(src.parent / "figures", out / "figures", dirs_exist_ok=True)
# convert_to_pdf keeps no .tex on success, so build it once more through the same path to read.
with tempfile.TemporaryDirectory() as build:
    fixed = apply_outside_fences(md.read_text(encoding="utf-8"), preprocess_markdown)
    (out / "build.tex").write_text(build_tex(fixed, Path(build)), encoding="utf-8")
pdf, warning = convert_to_pdf(str(md))
(out / "warning.txt").write_text(warning or "", encoding="utf-8")
print(pdf, "| warning:", warning)
