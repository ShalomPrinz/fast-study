"""The shared rules of Gemini auto retry: which failures retry and when the next re-run is due.
The schedulers (pipeline/runner.py, course/runner.py) own the timers and state."""

from datetime import datetime, timedelta, timezone

from services import settings

_TRANSIENT_CODES = frozenset(
    {"gemini_overloaded", "gemini_timeout", "gemini_unreachable"}
)


def is_transient(code: str | None, params: dict) -> bool:
    """True for a failure a later attempt can clear: overload, timeout, a network failure or a
    per-minute quota. A daily quota stays until the midnight-Pacific reset, so it never retries."""

    if code == "gemini_quota_exhausted":
        return params.get("scope") == "per_minute"
    return code in _TRANSIENT_CODES


def next_retry(done: int) -> tuple[dict, float] | None:
    """The {attempt, of, at} field and the delay in seconds for the retry after `done` earlier
    ones, or None when the switch is off or the count is spent. Settings are read now, so a
    changed count or delay applies to the next retry scheduled only."""

    total = settings.auto_retry_count()
    if not settings.auto_retry() or done >= total:
        return None
    delay = settings.auto_retry_minutes() * 60
    at = datetime.now(timezone.utc) + timedelta(seconds=delay)
    return {"attempt": done + 1, "of": total, "at": at.isoformat()}, delay
