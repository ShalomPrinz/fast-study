import os
import re
import sys

SERVICES = frozenset({"backend", "database", "server", "auto", "electron", "frontend"})

# The longest an exit waits to flush queued events; pinned, not left to the SDK default, because the
# Sentry host may be down and nothing may wait on it. The launcher's kill grace assumes it.
SHUTDOWN_TIMEOUT_S = 2

_HE = "֐-׿יִ-ﭏ"
# A Hebrew run, joined across the spaces and punctuation inside a name, in literal form and in the
# percent-, \u- and \x-escaped forms a URL, a JSON dump or a bytes repr carries it in.
_HEBREW = re.compile(
    rf"[{_HE}]+(?:[\s\-_'\"]+[{_HE}]+)*"
    r"|(?:%(?:D[67]|EF%A[CD])%[89AB][0-9A-F])+(?:(?:%20|\+|[-_])+(?:%(?:D[67]|EF%A[CD])%[89AB][0-9A-F])+)*"
    r"|(?:\\u(?:05[89a-f]|fb[1-4])[0-9a-f])+"
    r"|(?:\\x[d][67]\\x[89ab][0-9a-f])+",
    re.IGNORECASE,
)
# A profile folder under a Windows, Linux or macOS home root: the prefix stays, the name goes. A
# name with spaces counts only when a separator closes it, so trailing prose is not swallowed.
_HOME_GENERIC = re.compile(
    r"((?:[A-Za-z]:)?[\\/]+(?:Users|home)[\\/]+)"
    r"(?:[^\\/\r\n\t'\"<>|:]+?(?=[\\/])|[^\\/\s'\"<>|:]+)",
    re.IGNORECASE,
)
_API_KEYS = re.compile(r"gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{35}")
_SECRET_PARAM = re.compile(r"([?&]secret=)[^&#\s'\"]+", re.IGNORECASE)
# The rest of a path after a matched root: segments run to a quote, a colon or a line break.
_PATH_TAIL = r"(?:[\\/]+[^\\/\r\n\t'\"<>|:]*)*"
_KEY_ENVS = ("GROQ_API_KEY", "GEMINI_API_KEY", "FASTSTUDY_SECRET")


def _root_pattern(root):
    """A regex for a filesystem root that matches either separator, doubled or not, any case."""

    parts = [re.escape(p) for p in re.split(r"[\\/]+", root) if p]
    if not parts:
        return None
    lead = r"[\\/]+" if root[:1] in "\\/" else ""
    return lead + r"[\\/]+".join(parts) + r"(?![\w.-])"


def _scrub_str(s):
    """Redact keys, the launch secret, DATA_ROOT paths, home folders and Hebrew runs from one string."""

    for name in _KEY_ENVS:
        value = os.environ.get(name)
        if value and len(value) >= 8:
            s = s.replace(value, "<key>")
    s = _API_KEYS.sub("<key>", s)
    s = _SECRET_PARAM.sub(r"\1<key>", s)
    data_root = _root_pattern(os.environ.get("DATA_ROOT") or "")
    if data_root:
        s = re.sub(data_root + _PATH_TAIL, "<data>", s, flags=re.IGNORECASE)
    home_dir = os.path.expanduser("~")
    home = _root_pattern(home_dir) if home_dir != "~" else None
    if home:
        s = re.sub(home, "<home>", s, flags=re.IGNORECASE)
    s = _HOME_GENERIC.sub(r"\1<user>", s)
    return _HEBREW.sub("<hebrew>", s)


def _walk(value):
    if isinstance(value, str):
        return _scrub_str(value)
    if isinstance(value, dict):
        return {
            (_scrub_str(k) if isinstance(k, str) else k): _walk(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_walk(v) for v in value]
    return value


def scrub(event, _hint=None):
    """`before_send`: every string in the event redacted, and the host name and user dropped."""

    # Drop on failure: an unscrubbed event is the leak this exists to prevent, a lost one is not.
    try:
        event = _walk(event)
        event.pop("server_name", None)
        event.pop("user", None)
        return event
    except Exception:
        return None


def scrub_breadcrumb(crumb, _hint=None):
    """`before_breadcrumb`: the same redaction applied to one breadcrumb, dropped on failure."""

    try:
        return _walk(crumb)
    except Exception:
        return None


def _platform():
    if sys.platform.startswith(("win", "cygwin")):
        return "win32"
    if sys.platform.startswith("linux"):
        return "linux"
    return sys.platform


def tags(service):
    """The tags every event carries; an unknown service is a wiring bug, so it raises."""

    if service not in SERVICES:
        raise ValueError(
            f"unknown service {service!r}; expected one of {sorted(SERVICES)}"
        )
    return {"service": service, "platform": _platform()}


def enabled(dsn=None):
    """Whether to init at all: no DSN means no SDK, and there is no fallback DSN."""

    return bool(dsn or os.environ.get("FASTSTUDY_SENTRY_DSN"))


def options(service, *, dsn=None, version=None, environment=None):
    """kwargs for `sentry_sdk.init`; tags go through `sentry_sdk.set_tags(tags(service))` after it."""

    tags(service)
    version = version or os.environ.get("FASTSTUDY_VERSION") or "unknown"
    if environment is None:
        environment = (
            "production" if os.environ.get("FASTSTUDY_SECRET") else "development"
        )
    return {
        "dsn": dsn or os.environ.get("FASTSTUDY_SENTRY_DSN") or None,
        "release": f"faststudy@{version}",
        "environment": environment,
        # No traces_sample_rate: even 0.0 turns tracing on and propagates trace headers.
        "sample_rate": 1.0,
        "send_default_pii": False,
        "shutdown_timeout": SHUTDOWN_TIMEOUT_S,
        "before_send": scrub,
        "before_breadcrumb": scrub_breadcrumb,
    }
