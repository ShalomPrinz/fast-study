"""User-facing backend settings: the effective Gemini model, the Drive toggle, and the
writer POST /config uses. Every value is read at call time, never at import, so a config
update applies to the running process with no restart."""

import os

# Curated: a model id the free tier does not serve fails minutes into a run, so the
# frontend picks from this list instead of accepting free text.
GEMINI_MODELS = ["gemini-3.5-flash"]

# How much of the pipeline an automatic trigger may run. A ceiling, not a schedule: it caps
# both a new video's arrival and the 03:00 cron, and never the user's own run.
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
}


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
