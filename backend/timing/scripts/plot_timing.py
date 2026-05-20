"""Visualize timing.db: one scatter per operation with the linear-regression
fit used by `get_stats`, so records distorting the estimate stand out.

Run: python3 backend/timing/scripts/plot_timing.py
Outputs PNGs to backend/timing/plots/ and an index plots/_all.png.
"""
import sqlite3
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

TIMING_DIR = Path(__file__).resolve().parent.parent
DB = TIMING_DIR / "timing.db"
OUT = TIMING_DIR / "plots"
OUT.mkdir(exist_ok=True)

OUTLIER_K = 2.0  # residual > K * std flagged as outlier


def fit(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0, (sum(ys) / n if n else 0.0)
    sx, sy = sum(xs), sum(ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    sxx = sum(x * x for x in xs)
    denom = n * sxx - sx * sx
    if denom == 0:
        return 0.0, sy / n
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


def load():
    with sqlite3.connect(DB) as conn:
        rows = conn.execute(
            "SELECT id, operation, file_size_bytes, duration_seconds, recorded_at "
            "FROM timing ORDER BY operation, recorded_at"
        ).fetchall()
    by_op = {}
    for r in rows:
        by_op.setdefault(r[1], []).append(r)
    return by_op


def plot_op(ax, op, rows):
    ids = [r[0] for r in rows]
    xs_b = [r[2] for r in rows]
    ys = [r[3] for r in rows]
    xs_mb = [b / 1_000_000 for b in xs_b]

    slope, intercept = fit(xs_b, ys)
    preds = [slope * b + intercept for b in xs_b]
    resids = [y - p for y, p in zip(ys, preds)]
    n = len(resids)
    mean_r = sum(resids) / n if n else 0.0
    var_r = sum((r - mean_r) ** 2 for r in resids) / n if n else 0.0
    std_r = var_r ** 0.5
    threshold = OUTLIER_K * std_r if std_r > 0 else float("inf")

    normal_x, normal_y, out_x, out_y, out_lbl = [], [], [], [], []
    for i, (x_mb, y, r) in enumerate(zip(xs_mb, ys, resids)):
        if abs(r) > threshold:
            out_x.append(x_mb); out_y.append(y)
            out_lbl.append(f"id={ids[i]}\n{r:+.1f}s")
        else:
            normal_x.append(x_mb); normal_y.append(y)

    ax.scatter(normal_x, normal_y, s=28, alpha=0.7, label=f"n={n}")
    ax.scatter(out_x, out_y, s=60, color="red", marker="x",
               label=f"outliers (|resid|>{OUTLIER_K}σ)")
    for x, y, lbl in zip(out_x, out_y, out_lbl):
        ax.annotate(lbl, (x, y), fontsize=7, color="red",
                    xytext=(4, 4), textcoords="offset points")

    if n >= 2 and xs_b:
        xa = min(xs_b); xb = max(xs_b)
        ax.plot([xa / 1e6, xb / 1e6],
                [slope * xa + intercept, slope * xb + intercept],
                color="gray", linewidth=1, label="linear fit")

    ax.set_title(f"{op}  (σ residual = {std_r:.2f}s)")
    ax.set_xlabel("file_size (MB)")
    ax.set_ylabel("duration (s)")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=8, loc="best")


def main():
    by_op = load()
    ops = sorted(by_op.keys())

    # combined figure
    cols = 2
    rows_n = (len(ops) + cols - 1) // cols
    fig, axes = plt.subplots(rows_n, cols, figsize=(12, 4 * rows_n))
    axes = axes.flatten() if rows_n * cols > 1 else [axes]
    for ax, op in zip(axes, ops):
        plot_op(ax, op, by_op[op])
    for ax in axes[len(ops):]:
        ax.set_visible(False)
    fig.tight_layout()
    fig.savefig(OUT / "_all.png", dpi=110)
    plt.close(fig)

    # one PNG per operation
    for op in ops:
        fig, ax = plt.subplots(figsize=(8, 5))
        plot_op(ax, op, by_op[op])
        fig.tight_layout()
        fig.savefig(OUT / f"{op}.png", dpi=110)
        plt.close(fig)

    print(f"wrote {len(ops) + 1} PNGs to {OUT}")
    for op in ops:
        rows = by_op[op]
        ys = [r[3] for r in rows]
        print(f"  {op:11s} n={len(rows):3d}  min={min(ys):7.2f}s  "
              f"max={max(ys):7.2f}s  avg={sum(ys)/len(ys):7.2f}s")


if __name__ == "__main__":
    main()
