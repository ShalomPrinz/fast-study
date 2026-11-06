"""Generates econ-slides.pdf and econ-slides.pptx, the figure-extraction fixtures.

Not a runtime dependency: needs matplotlib and python-pptx, so run it in a throwaway venv:
    python make_deck.py [outdir]
Three slides, each a graph beside bullet text (slides 1 and 3 carry a footer), then a text-only slide.
"""

import io
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle
from pptx import Presentation
from pptx.util import Inches, Pt

W_IN, H_IN = 13.333, 7.5
FOOTER = "Microeconomics 101 - Lecture 4 - Fall term"

SLIDES = [
    (
        "Edgeworth box",
        [
            "Two consumers share a fixed endowment",
            "Each corner is one consumer's origin",
            "Efficient points lie on the contract curve",
        ],
        True,
    ),
    (
        "Indifference curves",
        [
            "Higher curves mean more utility",
            "Curves are convex to the origin",
            "The optimum is where the budget line is tangent",
        ],
        False,
    ),
    (
        "Utility possibility frontier",
        [
            "Maps every efficient allocation to utilities",
            "Points inside the frontier are wasteful",
            "Points outside are infeasible",
        ],
        True,
    ),
]
TEXT_ONLY = (
    "Summary",
    ["Efficiency is not fairness", "Trade-offs live on the frontier"],
)


def edgeworth(ax):
    ax.add_patch(Rectangle((0, 0), 10, 8, fill=False, lw=1.5))
    t = np.linspace(0.6, 9.4, 100)
    for k in (0.8, 1.4):
        ax.plot(t, k * 8 / (t / 2 + 0.01) / 4, "b-", lw=1)
    for k in (0.8, 1.4):
        ax.plot(10 - t, 8 - k * 8 / (t / 2 + 0.01) / 4, "r-", lw=1)
    ax.plot([0, 10], [0, 8], "g--", lw=1.2, label="contract curve")
    ax.set_xlim(-1, 11)
    ax.set_ylim(-1, 9)
    ax.set_xlabel("Good X")
    ax.set_ylabel("Good Y")
    ax.text(-0.3, -0.7, "O_A")
    ax.text(10.1, 8.2, "O_B")
    ax.legend(loc="lower right", fontsize=8)


def indifference(ax):
    x = np.linspace(0.5, 9, 100)
    for u, c in ((6, "#1f77b4"), (12, "#2ca02c"), (20, "#d62728")):
        ax.plot(x, u / x, c, label=f"U = {u}")
    ax.plot(x, 8 - 0.9 * x, "k--", label="budget")
    ax.set_xlim(0, 9)
    ax.set_ylim(0, 9)
    ax.set_xlabel("Apples")
    ax.set_ylabel("Oranges")
    ax.legend(fontsize=8)


def frontier(ax):
    u = np.linspace(0, 10, 100)
    ax.plot(u, np.sqrt(100 - u**2), "m-", lw=2)
    ax.fill_between(u, 0, np.sqrt(100 - u**2), alpha=0.1, color="m")
    ax.plot([6], [8], "ko")
    ax.annotate("efficient", (6, 8), (7, 9))
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 11)
    ax.set_xlabel("Utility of consumer A")
    ax.set_ylabel("Utility of consumer B")


DRAW = [edgeworth, indifference, frontier]


def slide_page(pdf, title, bullets, footer, draw=None):
    fig = plt.figure(figsize=(W_IN, H_IN))
    fig.text(0.05, 0.9, title, fontsize=30, weight="bold")
    if draw:
        draw(fig.add_axes([0.1, 0.24, 0.4, 0.55]))
    for i, b in enumerate(bullets):
        y = 0.72 - i * 0.12
        fig.text(0.57, y, "•", fontsize=18)
        fig.text(0.6, y, b, fontsize=15)
    if footer:
        fig.text(0.05, 0.04, FOOTER, fontsize=12)
    fig.add_artist(
        Rectangle((0.92, 0.9), 0.04, 0.05, fc="#223", transform=fig.transFigure)
    )
    pdf.savefig(fig)
    plt.close(fig)


def graph_png(draw):
    fig = plt.figure(figsize=(6, 4.6))
    draw(fig.add_axes([0.14, 0.15, 0.8, 0.8]))
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110)
    plt.close(fig)
    return buf.getvalue()


def logo_png():
    fig = plt.figure(figsize=(0.4, 0.4))
    fig.patch.set_facecolor("#223")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100)
    plt.close(fig)
    return buf.getvalue()


def make_pdf(path):
    with PdfPages(path) as pdf:
        for (title, bullets, footer), draw in zip(SLIDES, DRAW, strict=True):
            slide_page(pdf, title, bullets, footer, draw)
        slide_page(pdf, *TEXT_ONLY, footer=False)


def make_pptx(path):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(W_IN), Inches(H_IN)
    blank = prs.slide_layouts[6]
    logo = logo_png()
    for (title, bullets, footer), draw in zip(
        SLIDES + [(*TEXT_ONLY, False)], DRAW + [None], strict=True
    ):
        s = prs.slides.add_slide(blank)
        tb = s.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(9), Inches(1))
        tb.text_frame.text = title
        tb.text_frame.paragraphs[0].runs[0].font.size = Pt(32)
        if draw:
            s.shapes.add_picture(
                io.BytesIO(graph_png(draw)), Inches(0.6), Inches(1.5), width=Inches(6)
            )
        box = s.shapes.add_textbox(Inches(7.4), Inches(1.8), Inches(5.4), Inches(3))
        for i, b in enumerate(bullets):
            p = (
                box.text_frame.paragraphs[0]
                if i == 0
                else box.text_frame.add_paragraph()
            )
            p.text = "• " + b
            p.runs[0].font.size = Pt(20)
        if footer:
            f = s.shapes.add_textbox(Inches(0.6), Inches(6.9), Inches(8), Inches(0.4))
            f.text_frame.text = FOOTER
        s.shapes.add_picture(
            io.BytesIO(logo), Inches(12.4), Inches(0.3), width=Inches(0.4)
        )
    prs.save(path)


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
    make_pdf(out / "econ-slides.pdf")
    make_pptx(out / "econ-slides.pptx")
