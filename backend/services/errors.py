"""The machine `code` + flat `params` every failure carries beside its English prose.
Vocabulary and the reasoning behind the split: docs/ERROR-CODES.md at the repo root."""

import logging
import os
import sys

log = logging.getLogger("errors")

# Codes naming a condition, not a bug of ours — a provider's availability (Groq/Gemini) or the
# user's own setup (Drive not connected, a material over the size cap): they stay out of Sentry. Uncoded failures keep reporting.
CONDITION_CODES = frozenset(
    {
        "drive_not_connected",
        "gemini_overloaded",
        "gemini_quota_exhausted",
        "gemini_quota_blocked",
        "groq_rate_limited",
        "groq_rate_limit_blocked",
        "material_too_large",
    }
)


class CodedError(RuntimeError):
    """A failure naming itself: a stable `code` and flat `params` beside the developer-facing
    prose. Subclassed where a caller has to catch the failure by type."""

    # message/code are positional-only: `latex_error` carries a param literally named `message`.
    def __init__(self, message: str, code: str, /, **params):
        super().__init__(message)
        self.code = code
        self.params = params


def failure(message: str, code: str, /, **params) -> dict:
    """One failure body — the shape every non-2xx answers with."""

    return {"error": message, "code": code, "params": params}


def _is_own_executable(filename) -> bool:
    if not isinstance(filename, (str, os.PathLike)):
        return False
    same = os.path.normcase(os.path.realpath(filename))
    return same == os.path.normcase(os.path.realpath(sys.executable))


def app_files_blocked(exc: BaseException) -> bool:
    """True when the frozen bundle's own executable became unreadable mid-run (an antivirus
    quarantining or locking it): an OSError naming sys.executable anywhere in the chain."""

    if not getattr(sys, "frozen", False):
        return False
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, OSError) and (
            _is_own_executable(cur.filename) or _is_own_executable(cur.filename2)
        ):
            return True
        cur = cur.__cause__ or cur.__context__
    return False


def own_fields(exc: BaseException) -> tuple[str, dict] | None:
    """The (code, params) an exception names, or None when it names none. A blocked app file
    overrides any code and hides the OS text, so the full exception is logged here instead."""

    if app_files_blocked(exc):
        log.warning("app files blocked: %s", exc, exc_info=exc)
        return "app_files_blocked", {}
    if isinstance(exc, CodedError):
        return exc.code, exc.params
    return None


def error_fields(exc: BaseException, fallback: str) -> tuple[str, dict]:
    """The (code, params) of any exception: its own when it carries them, else `fallback`
    with str(exc) as `detail` — third-party text never gets a code of its own."""

    return own_fields(exc) or (fallback, {"detail": str(exc)})
