import os
import time
import sqlite3
import functools
from pathlib import Path

DB_PATH = Path(__file__).parent / "timing.db"


def init_db():
    """Create the timing table if it doesn't exist."""

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS timing (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                duration_seconds REAL NOT NULL,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


def _record(operation: str, file_size_bytes: int, duration_seconds: float):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO timing (operation, file_size_bytes, duration_seconds) VALUES (?, ?, ?)",
            (operation, file_size_bytes, duration_seconds),
        )


def record(operation: str, file_size_bytes: int, duration_seconds: float) -> dict:
    """Public entry point for recording a sample (used by external services over HTTP)."""

    operation = (operation or "").strip()
    if not operation:
        return {"status": "error", "message": "operation is required"}
    if file_size_bytes <= 0:
        return {"status": "error", "message": f"file_size_bytes must be positive, got {file_size_bytes}"}
    if duration_seconds <= 0:
        return {"status": "error", "message": f"duration_seconds must be positive, got {duration_seconds}"}

    _record(operation, file_size_bytes, duration_seconds)
    return {"status": "ok"}


def get_stats(operation: str, file_size_bytes: int) -> dict:
    """Duration stats for one operation, with a linear-regression estimate for this file size.
    All durations are in seconds; falls back to the average below two data points."""

    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT file_size_bytes, duration_seconds FROM timing WHERE operation = ?",
            (operation,),
        ).fetchall()

    if not rows:
        return {
            "message": "not-enough-data",
        }

    xs = [r[0] for r in rows]
    ys = [r[1] for r in rows]
    n = len(rows)

    shortest = min(ys)
    longest = max(ys)
    average = sum(ys) / n

    if n >= 2:
        sum_x = sum(xs)
        sum_y = sum(ys)
        sum_xy = sum(x * y for x, y in zip(xs, ys))
        sum_xx = sum(x * x for x in xs)
        denom = n * sum_xx - sum_x ** 2
        if denom != 0:
            slope = (n * sum_xy - sum_x * sum_y) / denom
            intercept = (sum_y - slope * sum_x) / n
            estimated = max(0.0, slope * file_size_bytes + intercept)
        else:
            estimated = average
    else:
        estimated = average

    return {
        "shortest": shortest,
        "longest": longest,
        "average": average,
        "estimated": estimated,
    }


def timed_pipeline(operation: str):
    """Decorator recording a pipeline call's duration against its first argument's file size."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            input_val = args[0] if args else None
            if input_val and isinstance(input_val, (str, Path)):
                p = Path(input_val)
                file_size = p.stat().st_size if p.exists() else len(str(input_val).encode())
            else:
                file_size = 0

            start = time.perf_counter()
            result = func(*args, **kwargs)
            duration = time.perf_counter() - start

            _record(operation, file_size, duration)
            return result
        return wrapper
    return decorator
