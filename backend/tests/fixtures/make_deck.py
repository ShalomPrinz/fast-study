"""Generate econ-slides.pdf (vector graphs) and econ-slides.pptx (PNG graphs + logo + EMF + decor)."""

import io
import struct
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.backends.backend_pdf import PdfPages
from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Pt

OUT = Path(sys.argv[1])
FONTS = Path("/home/shalom/fast_study/backend/assets/fonts")
for f in ("NotoSansHebrew-Regular.ttf", "NotoSansHebrew-Bold.ttf"):
    font_manager.fontManager.addfont(str(FONTS / f))
plt.rcParams["font.family"] = ["Noto Sans Hebrew", "DejaVu Sans"]
plt.rcParams["pdf.fonttype"] = 42

H = lambda s: s  # matplotlib shapes RTL itself


# ---- graphs: each draws into an axes ----
def edgeworth(ax):
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 8)
    t = np.linspace(0.6, 9.4, 200)
    for k in (6, 14, 24):
        ax.plot(t, k / t, color="tab:blue")
    for k in (6, 14, 24):
        ax.plot(10 - t, 8 - k / t, color="tab:red")
    c = np.linspace(0.3, 9.7, 50)
    ax.plot(c, 0.8 * c, "k--", label="contract curve")
    ax.plot([6.5], [2.2], "ko")
    ax.annotate("ω (endowment)", (6.5, 2.2), (7, 1.2), arrowprops=dict(arrowstyle="->"))
    ax.set_xlabel("$x_A$ (good 1)")
    ax.set_ylabel("$y_A$ (good 2)")
    ax.text(0.1, 0.1, "$O_A$", fontsize=13)
    ax.text(9.5, 7.5, "$O_B$", fontsize=13)
    ax.legend(loc="upper left", fontsize=9)
    ax.set_title("Edgeworth box")


def indifference(ax):
    x = np.linspace(0.5, 10, 200)
    for u, lab in ((8, "$U_1$"), (14, "$U_2$"), (22, "$U_3$")):
        ax.plot(x, u / x, label=lab)
    ax.plot(x, 9 - 1.2 * x, "k", lw=2, label="budget: $p_1x_1+p_2x_2=m$")
    ax.plot([3.75], [4.5], "ro")
    ax.annotate(
        "$x^*$ optimum", (3.75, 4.5), (5.5, 6), arrowprops=dict(arrowstyle="->")
    )
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.set_xlabel("$x_1$")
    ax.set_ylabel("$x_2$")
    ax.legend(fontsize=9)
    ax.set_title("Indifference curves and budget line")


def upf(ax):
    t = np.linspace(0, np.pi / 2, 200)
    ax.plot(10 * np.cos(t), 8 * np.sin(t), lw=2, label="UPF")
    ax.fill_between(10 * np.cos(t), 0, 8 * np.sin(t), alpha=0.12)
    ax.plot([4], [3], "ko")
    ax.annotate("inefficient point", (4, 3), (1, 1.5), arrowprops=dict(arrowstyle="->"))
    ax.plot([7.07], [5.66], "go")
    ax.annotate(
        "Pareto efficient", (7.07, 5.66), (7.5, 7), arrowprops=dict(arrowstyle="->")
    )
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 9)
    ax.set_xlabel("$u_A$")
    ax.set_ylabel("$u_B$")
    ax.legend(fontsize=9)
    ax.set_title("Utility possibility frontier")


# ---- slides: (title, bullets, graph fn, graph box in figure coords [l,b,w,h], bullets box) ----
SLIDES = [
    (
        "קופסת אדג'וורת' ועקומת החוזים",
        [
            "שני צרכנים, שני מוצרים, היצע קבוע",
            "כל נקודה בקופסה היא הקצאה אפשרית",
            "עקומת החוזים: נקודות ההשקה של עקומות האדישות",
            "מנקודת ההקצאה ההתחלתית ω אפשר לשפר את שניהם",
        ],
        edgeworth,
        [0.06, 0.10, 0.42, 0.68],
        "right",
    ),
    (
        "בחירת הצרכן: עקומות אדישות וקו תקציב",
        [
            "הצרכן בוחר את סל המוצרים על קו התקציב",
            "האופטימום: שיפוע עקומת האדישות שווה ליחס המחירים",
            "MRS = p1 / p2",
        ],
        indifference,
        [0.30, 0.08, 0.40, 0.52],
        "top",
    ),
    (
        "עקומת אפשרויות התועלת",
        [
            "כל נקודה על העקומה היא יעילה פארטו",
            "נקודה מתחת לעקומה אינה יעילה",
            "המשפט הראשון של הרווחה:",
            "שיווי משקל תחרותי הוא יעיל פארטו",
        ],
        upf,
        [0.52, 0.10, 0.42, 0.68],
        "left",
    ),
    (
        "סיכום ושאלות לתרגול",
        [
            "יעילות פארטו אינה אומרת דבר על צדק חלוקתי",
            "המשפט השני: כל הקצאה יעילה ניתנת להשגה עם העברות",
            "תרגיל 1: מצאו את עקומת החוזים עבור Cobb-Douglas",
            "תרגיל 2: הראו שהאופטימום מקיים MRS = p1/p2",
        ],
        None,
        None,
        "full",
    ),
]

W_IN, H_IN = 13.333, 7.5


def bullets_layout(where):
    # returns (x anchor, y top, ha) in figure coords
    return {
        "right": (0.95, 0.74, "right"),
        "left": (0.47, 0.74, "right"),
        "top": (0.95, 0.80, "right"),
        "full": (0.95, 0.74, "right"),
    }[where]


def draw_slide(fig, title, bullets, graph, box, where, num):
    fig.text(0.95, 0.90, H(title), ha="right", fontsize=28, weight="bold")
    fig.add_artist(plt.Line2D([0.05, 0.95], [0.86, 0.86], color="tab:blue", lw=2))
    x, y, ha = bullets_layout(where)
    step = 0.065 if where != "top" else 0.045
    for b in bullets:
        fig.text(x, y, H("• " + b), ha=ha, fontsize=17 if where != "top" else 15)
        y -= step
    if graph:
        graph(fig.add_axes(box))
    fig.text(
        0.05,
        0.03,
        H(f"כלכלת רווחה — הרצאה 7 | שקף {num}"),
        ha="left",
        fontsize=10,
        color="gray",
    )


def build_pdf(path):
    with PdfPages(path) as pdf:
        for i, s in enumerate(SLIDES, 1):
            fig = plt.figure(figsize=(W_IN, H_IN))
            draw_slide(fig, *s, i)
            pdf.savefig(fig)
            plt.close(fig)


def graph_png(fn):
    fig, ax = plt.subplots(figsize=(6.4, 4.8))
    fn(ax)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200)
    plt.close(fig)
    buf.seek(0)
    return buf


def logo_png():
    fig = plt.figure(figsize=(0.64, 0.64), dpi=100)
    fig.patch.set_facecolor("tab:blue")
    fig.text(
        0.5,
        0.5,
        "U",
        ha="center",
        va="center",
        color="white",
        fontsize=22,
        weight="bold",
    )
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100)
    plt.close(fig)
    buf.seek(0)
    return buf


def decor_png():
    # large decorative "photo": a smooth gradient, not a graph
    y, x = np.mgrid[0:600, 0:900]
    img = np.dstack([x / 900, y / 600, 0.5 + 0 * x])
    buf = io.BytesIO()
    plt.imsave(buf, img, format="png")
    buf.seek(0)
    return buf


def tiny_emf():
    # EMR_HEADER (88 bytes) + EMR_EOF (20 bytes): a valid empty 100x100 metafile
    size = 108
    hdr = struct.pack(
        "<II4i4i4sIIIHHIIIii",
        1,
        88,
        0,
        0,
        100,
        100,
        0,
        0,
        2646,
        2646,
        b" EMF",
        0x10000,
        size,
        2,
        0,
        0,
        0,
        0,
        0,
        1024,
        768,
    )
    hdr += struct.pack("<ii", 320, 240)
    eof = struct.pack("<IIIII", 14, 20, 0, 16, 20)
    return io.BytesIO(hdr + eof)


def build_pptx(path):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(int(W_IN * 914400)), Emu(int(H_IN * 914400))
    sw, sh = prs.slide_width, prs.slide_height
    blank = prs.slide_layouts[6]
    for i, (title, bullets, graph, box, where) in enumerate(SLIDES, 1):
        s = prs.slides.add_slide(blank)
        tb = s.shapes.add_textbox(
            int(sw * 0.05), int(sh * 0.04), int(sw * 0.9), int(sh * 0.1)
        )
        p = tb.text_frame.paragraphs[0]
        p.text, p.alignment = title, PP_ALIGN.RIGHT
        p.runs[0].font.size, p.runs[0].font.bold = Pt(28), True
        bx = {"right": 0.52, "left": 0.05, "top": 0.05, "full": 0.05}[where]
        bw = 0.43 if where in ("right", "left") else 0.9
        body = s.shapes.add_textbox(
            int(sw * bx), int(sh * 0.2), int(sw * bw), int(sh * 0.5)
        )
        body.text_frame.word_wrap = True
        for j, b in enumerate(bullets):
            para = (
                body.text_frame.paragraphs[0]
                if j == 0
                else body.text_frame.add_paragraph()
            )
            para.text, para.alignment = "• " + b, PP_ALIGN.RIGHT
            para.runs[0].font.size = Pt(18)
        if graph:
            l, b_, w, h = box
            s.shapes.add_picture(
                graph_png(graph),
                int(sw * l),
                int(sh * (1 - b_ - h)),
                int(sw * w),
                int(sh * h),
            )
        s.shapes.add_picture(
            logo_png(), int(sw * 0.02), int(sh * 0.02), Emu(457200), Emu(457200)
        )
        if i == 4:
            s.shapes.add_picture(
                decor_png(), int(sw * 0.3), int(sh * 0.62), int(sw * 0.4), int(sh * 0.3)
            )
        if i == 1:
            try:
                s.shapes.add_picture(
                    tiny_emf(), int(sw * 0.9), int(sh * 0.9), Emu(300000), Emu(300000)
                )
            except Exception as e:
                print("EMF skipped:", e)
    prs.save(path)


OUT.mkdir(parents=True, exist_ok=True)
build_pdf(OUT / "econ-slides.pdf")
build_pptx(OUT / "econ-slides.pptx")
print("done")
