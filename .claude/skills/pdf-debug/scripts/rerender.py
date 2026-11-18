"""Re-render a summary.md with the current backend code into <out_dir>: summary.md, summary.pdf, build.tex, warning.txt.

Usage (from backend/): uv run python ../.claude/skills/pdf-debug/scripts/rerender.py <summary.md> <out_dir>
"""

import shutil
import sys
from pathlib import Path

from pipeline import to_pdf

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
md = out / "summary.md"
shutil.copy2(src, md)
if (src.parent / "figures").is_dir():
    shutil.copytree(src.parent / "figures", out / "figures", dirs_exist_ok=True)
tex = out / "build.tex"
build_tex = to_pdf.build_tex


# convert_to_pdf keeps no .tex on success, so tap the one pandoc pass it runs.
def _keep_tex(markdown, build):
    source = build_tex(markdown, build)
    tex.write_text(source, encoding="utf-8")
    return source


to_pdf.build_tex = _keep_tex
pdf, warning = to_pdf.convert_to_pdf(str(md))
(out / "warning.txt").write_text(warning or "", encoding="utf-8")
print(pdf, "| warning:", warning)
