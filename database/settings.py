"""The browser-dev settings store: the repo-root `.env`, read and merged in place."""

import re
from pathlib import Path

from dotenv import dotenv_values

# Resolved from this file, never from the cwd — each service runs with its own directory as cwd.
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# Setting field → the env var the owning service actually reads.
STRING_FIELDS = {
    "data_root": "DATA_ROOT",
    "gemini_model": "GEMINI_MODEL",
    "gdrive_root_folder": "GDRIVE_ROOT_FOLDER",
    "ui_language": "UI_LANGUAGE",
}
BOOL_FIELDS = {
    "drive_enabled": "DRIVE_ENABLED",
    "runner_controls_visible": "RUNNER_CONTROLS_VISIBLE",
}

# Write-only: the read path reports set/unset only, so a stored key never travels to the client.
SECRET_FIELDS = {
    "gemini_api_key": "GEMINI_API_KEY",
    "groq_api_key": "GROQ_API_KEY",
}

UI_LANGUAGES = ("he", "en")

PROBE_NAME = ".faststudy_write_test"

# The `export ` prefix and the value text are captured so a rewritten line keeps both.
_ASSIGN = re.compile(
    r"^([^\S\r\n]*(?:export[^\S\r\n]+)?)([A-Za-z_][A-Za-z0-9_]*)[^\S\r\n]*=(.*)$"
)

# Unquoted values end at whitespace before a `#`; a quoted value ends at its closing quote.
_UNQUOTED_COMMENT = re.compile(r"[^\S\r\n]+#")

_TRUTHY = {"1", "true", "yes", "on"}


def _text(value) -> str | None:
    """Normalize a stored value to a non-empty string, or None when the key is absent or blank."""

    if not isinstance(value, str):
        return None
    return value.strip() or None


def _flag(value) -> bool | None:
    """Read a stored boolean, or None when the key is absent — the client applies its own default."""

    text = _text(value)
    return None if text is None else text.lower() in _TRUTHY


def _comment(rest: str) -> str:
    """Return the trailing `# ...` of an assignment's value text, so a rewrite keeps the comment."""

    text = rest.lstrip(" \t")
    if text[:1] in ("'", '"'):
        close = text.find(text[0], 1)
        tail = text[close + 1 :] if close != -1 else ""
    else:
        match = _UNQUOTED_COMMENT.search(text)
        tail = text[match.start() :] if match else ""
    return tail if "#" in tail else ""


def _quote(value: str) -> str:
    """Single-quote a value for `.env`: no escape processing, so Windows backslashes survive intact."""

    return f"'{value}'"


def _incoming(field: str, value) -> str:
    """Validate one incoming setting value and return the text to store."""

    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    text = value.strip()
    # Single quotes and newlines cannot be represented in the quoting above, and no real value has one.
    if "'" in text or "\n" in text or "\r" in text:
        raise ValueError(f"{field} may not contain quotes or line breaks")
    if field == "ui_language" and text and text not in UI_LANGUAGES:
        raise ValueError(f"ui_language must be one of {', '.join(UI_LANGUAGES)}")
    return text


def _incoming_flag(field: str, value) -> str:
    """Validate an incoming boolean and return the text to store."""

    # A bare truth test would let the string "false" store `true`, silently flipping the setting on.
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be a boolean")
    return "true" if value else "false"


def prepare_data_root(value) -> str:
    """Create the data root if missing and prove it is writable, returning the path to store."""

    text = _incoming("data_root", value)
    if not text:
        raise ValueError("data root may not be empty")
    path = Path(text)
    # Relative would resolve against each service's own cwd, silently splitting the data directory.
    if not path.is_absolute():
        raise ValueError(f"data root must be an absolute path: {text}")
    if path.exists() and not path.is_dir():
        raise ValueError(f"data root exists but is not a directory: {text}")
    try:
        path.mkdir(parents=True, exist_ok=True)
        # A probe write turns an unwritable root into a fixable error now, not a pipeline failure later.
        probe = path / PROBE_NAME
        probe.write_bytes(b"")
        probe.unlink()
    except OSError as e:
        raise ValueError(f"data root is not writable: {text} ({e})") from e
    return str(path)


def merge_env_text(text: str, updates: dict[str, str]) -> str:
    """Rewrite only the named keys in `.env` text; comments, ordering and unknown keys survive."""

    pending = dict(updates)
    written: set[str] = set()
    out: list[str] = []
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        match = _ASSIGN.match(body)
        key = match.group(2) if match else None
        if key in pending:
            ending = line[len(body) :] or "\n"
            prefix, comment = match.group(1), _comment(match.group(3))
            out.append(f"{prefix}{key}={_quote(pending.pop(key))}{comment}{ending}")
            written.add(key)
        elif key in written:
            # A later duplicate of a key we just rewrote would win at load time, so drop it.
            continue
        else:
            out.append(line)
    if pending:
        if out and not out[-1].endswith(("\n", "\r")):
            out.append("\n")
        out.extend(f"{k}={_quote(v)}\n" for k, v in pending.items())
    return "".join(out)


def read_settings() -> dict:
    """Report the stored settings; the two API keys collapse to a set/unset flag, never a value."""

    values = dotenv_values(ENV_PATH)
    stored = {field: _text(values.get(env)) for field, env in STRING_FIELDS.items()}
    stored |= {field: _flag(values.get(env)) for field, env in BOOL_FIELDS.items()}
    stored |= {
        f"{field}_set": _text(values.get(env)) is not None
        for field, env in SECRET_FIELDS.items()
    }
    return stored


def write_settings(patch: dict) -> dict:
    """Merge a partial settings object into the repo-root `.env` and return the stored view."""

    updates: dict[str, str] = {}
    for field, value in patch.items():
        if value is None:
            # A null means "leave it alone", so echoing back a read (all-null for unset) blanks nothing.
            continue
        if field == "data_root":
            updates["DATA_ROOT"] = prepare_data_root(value)
        elif field in STRING_FIELDS:
            updates[STRING_FIELDS[field]] = _incoming(field, value)
        elif field in SECRET_FIELDS:
            updates[SECRET_FIELDS[field]] = _incoming(field, value)
        elif field in BOOL_FIELDS:
            updates[BOOL_FIELDS[field]] = _incoming_flag(field, value)
        else:
            raise ValueError(f"unknown setting: {field}")
    if updates:
        text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
        ENV_PATH.write_text(merge_env_text(text, updates), encoding="utf-8")
    return read_settings()
