"""Crop the PDF region around an anchor phrase to a 200dpi PNG, for reading a reported defect by eye.

Usage (from backend/): uv run python ../.claude/skills/pdf-debug/scripts/crop.py <summary.pdf> "<anchor>" <out_dir>
"""

import pathlib
import sys

import fitz

pdf, anchor, out = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
doc = fitz.open(pdf)
# get_text() is visual order: a Hebrew word may come out reversed, so match either way.
words = [w for w in anchor.split() if len(w) > 1]
best = None
for i, page in enumerate(doc):
    for block in page.get_text("blocks"):
        score = sum(w in block[4] or w[::-1] in block[4] for w in words)
        if best is None or score > best[0]:
            best = (score, i, fitz.Rect(block[:4]))
score, i, rect = best
page = doc[i]
clip = fitz.Rect(
    page.rect.x0 + 20,
    max(rect.y0 - 50, 0),
    page.rect.x1 - 20,
    min(rect.y1 + 50, page.rect.y1),
)
out.mkdir(parents=True, exist_ok=True)
png = out / f"p{i + 1}_crop.png"
page.get_pixmap(dpi=200, clip=clip).save(png)
print(f"page {i + 1}/{len(doc)} matched {score}/{len(words)} words -> {png}")
