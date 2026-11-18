"""Crop the PDF region around an anchor phrase to a 200dpi PNG, for reading a reported defect by eye.

Usage (from backend/): uv run python ../.claude/skills/pdf-debug/scripts/crop.py <summary.pdf> "<anchor>" <out_dir>
"""

import pathlib
import sys

import fitz

pdf, anchor, out = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
doc = fitz.open(pdf)
PUNCT = ".,:;!?()[]{}\"'`*-–—"
words = [w.strip(PUNCT) for w in anchor.split()]
words = [w for w in words if w]
hits = []
for i, page in enumerate(doc):
    for block in page.get_text("blocks"):
        # Whole words only, so a short anchor word cannot hit inside a longer one.
        tokens = {t.strip(PUNCT) for t in block[4].split()}
        # get_text() is visual order: a Hebrew word may come out reversed, so match either way.
        score = sum(w in tokens or w[::-1] in tokens for w in words)
        # On a tie, the block the anchor fills most is the likelier one.
        hits.append((score, score / max(len(tokens), 1), i, fitz.Rect(block[:4])))
hits.sort(key=lambda h: h[:2], reverse=True)
score, _, i, rect = hits[0]
if score == 0:
    sys.exit(f"no block holds any word of {anchor!r}")
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
ties = [h for h in hits[1:] if h[0] == score]
if ties:
    print(
        f"warning: {len(ties)} other block(s) also matched {score} words; check the crop"
    )
