"""User-facing backend settings: the effective Gemini model, the Drive toggle, and the
writer POST /config uses. Every value is read at call time, never at import, so a config
update applies to the running process with no restart."""

import os

# Curated: a model id the free tier does not serve fails minutes into a run, so the
# frontend picks from this list instead of accepting free text.
GEMINI_MODELS = ["gemini-3.5-flash"]

# How much of the pipeline an automatic trigger may run. A ceiling, not a schedule: it caps
# both a new video's arrival and the nightly cron, and never the user's own run.
AUTO_RUN_MODES = ["off", "audio", "full"]

_TRUTHY = {"1", "true", "yes", "on"}

# Settings field name → the environment variable its consumer reads.
_ENV_KEYS = {
    "gemini_api_key": "GEMINI_API_KEY",
    "groq_api_key": "GROQ_API_KEY",
    "gemini_model": "GEMINI_MODEL",
    "drive_enabled": "DRIVE_ENABLED",
    "gdrive_root_folder": "GDRIVE_ROOT_FOLDER",
    "auto_run": "AUTO_RUN",
    "nightly_run": "NIGHTLY_RUN",
    "nightly_hour": "NIGHTLY_HOUR",
}

# The hour the nightly catch-up pass runs when NIGHTLY_HOUR says nothing usable.
DEFAULT_NIGHTLY_HOUR = 3


def gemini_model() -> str:
    """The model every Gemini call uses: GEMINI_MODEL, else the first curated entry."""

    return os.environ.get("GEMINI_MODEL") or GEMINI_MODELS[0]


def auto_run() -> str:
    """The automatic-work ceiling: AUTO_RUN, else `full`. An unrecognised value means `full` too,
    so a typo can never silently stop every unattended run."""

    mode = os.environ.get("AUTO_RUN", "").strip().lower()
    return mode if mode in AUTO_RUN_MODES else "full"


def drive_enabled() -> bool:
    """Whether the Drive upload step runs. Opt-in: unset means off, so an install that
    never configured Drive completes each lecture at its PDF."""

    return os.environ.get("DRIVE_ENABLED", "").strip().lower() in _TRUTHY


def nightly_run() -> bool:
    """Whether the nightly catch-up cron is scheduled. Unset means on, unlike the opt-in
    drive_enabled(): the cron ran before it was a setting, so no value must keep that."""

    value = os.environ.get("NIGHTLY_RUN")
    return True if value is None else value.strip().lower() in _TRUTHY


def nightly_hour() -> int:
    """The hour (0-23) the nightly pass fires. Unset, non-numeric or out of range all mean
    the default, so a bad value can never leave the app with no nightly pass."""

    try:
        hour = int(os.environ.get("NIGHTLY_HOUR", ""))
    except ValueError:
        return DEFAULT_NIGHTLY_HOUR
    return hour if 0 <= hour <= 23 else DEFAULT_NIGHTLY_HOUR


def apply_config(values: dict) -> list[str]:
    """Write the given settings into the process environment; returns the field names
    applied. Values are never logged — one of them is an API key."""

    applied = []
    for field, value in values.items():
        env_key = _ENV_KEYS.get(field)
        if env_key is None or value is None:
            continue
        os.environ[env_key] = (
            str(value).lower() if isinstance(value, bool) else str(value)
        )
        applied.append(field)
    return applied
