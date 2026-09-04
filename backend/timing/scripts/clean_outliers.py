"""Delete outlier rows from timing.db so they stop distorting ETA estimates.

Outlier rule, per operation: fit a line `duration = slope * file_size + intercept`
(same fit as `timing.get_stats`), then flag rows whose residual exceeds K * σ.

Usage:
    python3 backend/timing/scripts/clean_outliers.py            # dry run
    python3 backend/timing/scripts/clean_outliers.py --apply    # actually delete
    python3 backend/timing/scripts/clean_outliers.py --apply --k 2.5
    python3 backend/timing/scripts/clean_outliers.py --apply --op transcribe
"""

import argparse
import sqlite3
import sys
from pathlib import Path

# Run as a plain script from the repo root, so `backend/` is not importable yet.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from timing import DB_PATH as DB


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


def find_outliers(rows, k):
    """rows: [(id, size, duration), ...]. Returns (outlier_ids, std)."""
    if len(rows) < 3:
        return [], 0.0
    xs = [r[1] for r in rows]
    ys = [r[2] for r in rows]
    slope, intercept = fit(xs, ys)
    resids = [y - (slope * x + intercept) for x, y in zip(xs, ys)]
    mean_r = sum(resids) / len(resids)
    std_r = (sum((r - mean_r) ** 2 for r in resids) / len(resids)) ** 0.5
    if std_r == 0:
        return [], 0.0
    threshold = k * std_r
    return [r[0] for r, res in zip(rows, resids) if abs(res) > threshold], std_r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--apply", action="store_true", help="actually delete (default: dry-run)"
    )
    ap.add_argument(
        "--k",
        type=float,
        default=2.0,
        help="residual threshold in std devs (default 2.0)",
    )
    ap.add_argument(
        "--op",
        action="append",
        help="limit to this operation (repeatable); default: all",
    )
    args = ap.parse_args()

    with sqlite3.connect(DB) as conn:
        ops_q = "SELECT DISTINCT operation FROM timing"
        ops = [r[0] for r in conn.execute(ops_q).fetchall()]
        if args.op:
            ops = [o for o in ops if o in args.op]

        to_delete: list[tuple[str, int, float, float]] = []  # (op, id, size, dur)

        for op in ops:
            rows = conn.execute(
                "SELECT id, file_size_bytes, duration_seconds FROM timing "
                "WHERE operation = ?",
                (op,),
            ).fetchall()

            outlier_ids, std_r = find_outliers(rows, args.k)
            by_id = {r[0]: r for r in rows}
            for rid in sorted(outlier_ids):
                _, size, dur = by_id[rid]
                to_delete.append((op, rid, size, dur))

            print(
                f"{op:11s} n={len(rows):3d}  σ={std_r:6.2f}s  "
                f"outliers={len(outlier_ids)}"
            )

        if not to_delete:
            print("nothing to delete.")
            return

        print("\nrows targeted:")
        for op, rid, size, dur in to_delete:
            print(
                f"  {op:11s} id={rid:<5d} size={size / 1e6:7.2f}MB  "
                f"duration={dur:8.2f}s"
            )

        if args.apply:
            conn.executemany(
                "DELETE FROM timing WHERE id = ?",
                [(rid,) for _, rid, _, _ in to_delete],
            )
            conn.commit()
            print(f"\ndeleted {len(to_delete)} rows.")
        else:
            print(f"\ndry run — pass --apply to delete {len(to_delete)} rows.")


if __name__ == "__main__":
    main()
