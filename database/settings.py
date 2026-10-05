"""The browser-dev settings store: the repo-root `.env`, read and merged in place."""

import os
import re
from pathlib import Path

from dotenv import dotenv_values
from fs.paths import CodedValueError

# Resolved from this file, never from the cwd — each service runs with its own directory as cwd.
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# Setting field → the env var the owning service actually reads.
STRING_FIELDS = {
    "data_root": "DATA_ROOT",
    "gemini_model": "GEMINI_MODEL",
    "gdrive_root_folder": "GDRIVE_ROOT_FOLDER",
    "auto_run": "AUTO_RUN",
    "moodle_site": "MOODLE_SITE",
}
BOOL_FIELDS = {
    "drive_enabled": "DRIVE_ENABLED",
    "nightly_run": "NIGHTLY_RUN",
}
INT_FIELDS = {
    "nightly_hour": "NIGHTLY_HOUR",
}

# Write-only: the read path reports set/unset only, so a stored key never travels to the client.
SECRET_FIELDS = {
    "gemini_api_key": "GEMINI_API_KEY",
    "groq_api_key": "GROQ_API_KEY",
}

PROBE_NAME = ".faststudy_write_test"

# The `export ` prefix and the value text are captured so a rewritten line keeps both.
_ASSIGN = re.compile(
    r"^([^\S\r\n]*(?:export[^\S\r\n]+)?)([A-Za-z_][A-Za-z0-9_]*)[^\S\r\n]*=(.*)$"
)

# Unquoted values end at whitespace before a `#`; a quoted value ends at its closing quote.
_UNQUOTED_COMMENT = re.compile(r"[^\S\r\n]+#")

_TRUTHY = {"1", "true", "yes", "on"}

# `C:` alone means "the current directory on drive C", so a drive root keeps its one backslash.
_DRIVE_ROOT = re.compile(r"^[A-Za-z]:$")

# Duplicated on purpose: the backend's copy is AUTO_RUN_MODES in backend/services/settings.py.
AUTO_RUN_MODES = ("off", "audio", "full")


def _text(value) -> str | None:
    """Normalize a stored value to a non-empty string, or None when the key is absent or blank."""

    if not isinstance(value, str):
        return None
    return value.strip() or None


def _flag(value) -> bool | None:
    """Read a stored boolean, or None when the key is absent — the client applies its own default."""

    text = _text(value)
    return None if text is None else text.lower() in _TRUTHY


def _int(value) -> int | None:
    """Read a stored integer, or None when the key is absent or unparsable — the client defaults."""

    text = _text(value)
    if text is None:
        return None
    try:
        return int(text)
    except ValueError:
        return None


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
    """Single-quote a value for `.env` with backslashes doubled; a drive root like `C:\\` goes unquoted."""

    # python-dotenv unescapes `\\` and `\'` inside single quotes, yet reads a closing `\\'` as an escaped
    # quote; unquoted values are read literally, and `_incoming` leaves only a drive root ending in `\`.
    if value.endswith("\\"):
        return value
    return "'" + value.replace("\\", "\\\\") + "'"


def _incoming(field: str, value) -> str:
    """Validate one incoming setting value and return the text to store, trailing `\\` stripped."""

    if not isinstance(value, str):
        raise CodedValueError(
            f"{field} must be a string", "setting_must_be_string", field=field
        )
    text = value.strip()
    # Single quotes and newlines cannot be represented in the quoting above, and no real value has one.
    if "'" in text or "\n" in text or "\r" in text:
        raise CodedValueError(
            f"{field} may not contain quotes or line breaks",
            "setting_may_not_contain_quotes",
            field=field,
        )
    stripped = text.rstrip("\\")
    if stripped != text and _DRIVE_ROOT.match(stripped):
        return stripped + "\\"
    return stripped


def _incoming_auto_run(value) -> str:
    """Validate an incoming auto-run mode and return it normalized to lowercase."""

    # The backend silently runs an unknown mode as `full`, so a typo must be refused here.
    text = _incoming("auto_run", value).lower()
    if text not in AUTO_RUN_MODES:
        raise CodedValueError(
            f"auto_run must be one of {', '.join(AUTO_RUN_MODES)}: {text}",
            "setting_invalid_choice",
            field="auto_run",
            value=text,
        )
    return text


def _incoming_flag(field: str, value) -> str:
    """Validate an incoming boolean and return the text to store."""

    # A bare truth test would let the string "false" store `true`, silently flipping the setting on.
    if not isinstance(value, bool):
        raise CodedValueError(
            f"{field} must be a boolean", "setting_must_be_boolean", field=field
        )
    return "true" if value else "false"


def _incoming_int(field: str, value) -> str:
    """Validate an incoming integer and return the text to store; range is the owning service's job."""

    # `isinstance(True, int)` is True, so without this guard a boolean would silently store 1 or 0.
    if isinstance(value, bool) or not isinstance(value, int):
        raise CodedValueError(
            f"{field} must be an integer", "setting_must_be_integer", field=field
        )
    return str(value)


def _check_data_root(value) -> Path:
    """Apply the data root's shape rules (non-empty, absolute, not a file) without touching disk."""

    text = _incoming("data_root", value)
    if not text:
        raise CodedValueError("data root may not be empty", "data_root_empty")
    path = Path(text)
    # Relative would resolve against each service's own cwd, silently splitting the data directory.
    if not path.is_absolute():
        raise CodedValueError(
            f"data root must be an absolute path: {text}",
            "data_root_not_absolute",
            path=text,
        )
    try:
        is_file = path.exists() and not path.is_dir()
    except OSError as e:
        # Python 3.12's exists() re-raises EACCES when a parent denies traversal, so that is unwritable too.
        raise _not_writable(path, str(e)) from e
    if is_file:
        raise CodedValueError(
            f"data root exists but is not a directory: {text}",
            "data_root_not_a_directory",
            path=text,
        )
    return path


def _not_writable(path: Path, detail: str) -> CodedValueError:
    """Build the one `data_root_not_writable` error both the save and the probe raise."""

    return CodedValueError(
        f"data root is not writable: {path} ({detail})",
        "data_root_not_writable",
        path=str(path),
        detail=detail,
    )


def prepare_data_root(value) -> str:
    """Create the data root if missing and prove it is writable, returning the path to store."""

    path = _check_data_root(value)
    try:
        path.mkdir(parents=True, exist_ok=True)
        # A probe write turns an unwritable root into a fixable error now, not a pipeline failure later.
        probe = path / PROBE_NAME
        probe.write_bytes(b"")
        probe.unlink()
    except OSError as e:
        raise _not_writable(path, str(e)) from e
    return str(path)


def probe_data_root(value) -> str:
    """Judge whether saving this data root would succeed, creating and writing nothing."""

    path = _check_data_root(value)
    # A missing root is fine when saving could create it, so judge its nearest existing ancestor.
    target = path
    while not target.exists() and target != target.parent:
        target = target.parent
    if not target.is_dir():
        raise _not_writable(path, f"{target} is not a directory")
    # os.access reads permission bits only (on Windows just the read-only flag), so the save's real
    # write stays authoritative; it is the one check that leaves nothing behind.
    if not os.access(target, os.W_OK | os.X_OK):
        raise _not_writable(path, f"permission denied: {target}")
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
    stored |= {field: _int(values.get(env)) for field, env in INT_FIELDS.items()}
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
        elif field == "auto_run":
            updates["AUTO_RUN"] = _incoming_auto_run(value)
        elif field in STRING_FIELDS:
            updates[STRING_FIELDS[field]] = _incoming(field, value)
        elif field in SECRET_FIELDS:
            updates[SECRET_FIELDS[field]] = _incoming(field, value)
        elif field in BOOL_FIELDS:
            updates[BOOL_FIELDS[field]] = _incoming_flag(field, value)
        elif field in INT_FIELDS:
            updates[INT_FIELDS[field]] = _incoming_int(field, value)
        else:
            raise CodedValueError(
                f"unknown setting: {field}", "unknown_setting", field=field
            )
    if updates:
        text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
        ENV_PATH.write_text(merge_env_text(text, updates), encoding="utf-8")
    return read_settings()
