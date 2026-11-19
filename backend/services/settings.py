"""User-facing backend settings and the writer POST /config uses. Every value is read at call
time, never at import, so an update applies with no restart."""

import os

# Curated, in fallback order: a model id the free tier does not serve fails minutes into a
# run, so the frontend picks from this table. API id -> the name the user sees.
GEMINI_MODEL_NAMES = {
    "gemini-4-hydrogen": "Gemini Hydrogen 4",
    "gemini-3.8-flash": "Gemini Flash 3.8",
    "gemini-3.6-flash": "Gemini Flash 3.6",
}
GEMINI_MODELS = list(GEMINI_MODEL_NAMES)

# How much of the pipeline an automatic trigger may run. A ceiling, not a schedule: it caps
# a new video's arrival, and never the user's own run.
AUTO_RUN_MODES = ["off", "audio", "full"]

# What auto-remove deletes, cumulatively: `audio` takes video.mp4 too.
AUTO_REMOVE_MODES = ["off", "video", "audio"]
# The output whose existence makes a lecture's intermediates removable.
AUTO_REMOVE_AFTER = ["pdf", "drive"]

_TRUTHY = {"1", "true", "yes", "on"}
_FALSY = {"0", "false", "no", "off"}
# GEMINI_FALLBACK_MODELS value for an empty list; a blank would read as never saved.
_NO_FALLBACK = "none"

# Settings field name → the environment variable its consumer reads.
_ENV_KEYS = {
    "gemini_api_key": "GEMINI_API_KEY",
    "groq_api_key": "GROQ_API_KEY",
    "gemini_model": "GEMINI_MODEL",
    "gemini_auto_fallback": "GEMINI_AUTO_FALLBACK",
    "gemini_fallback_models": "GEMINI_FALLBACK_MODELS",
    "drive_enabled": "DRIVE_ENABLED",
    "gdrive_root_folder": "GDRIVE_ROOT_FOLDER",
    "auto_run": "AUTO_RUN",
    "auto_remove": "AUTO_REMOVE",
    "auto_remove_after": "AUTO_REMOVE_AFTER",
    "auto_retry": "AUTO_RETRY",
    "auto_retry_count": "AUTO_RETRY_COUNT",
    "auto_retry_minutes": "AUTO_RETRY_MINUTES",
    "summary_figures": "SUMMARY_FIGURES",
}

# Auto-retry defaults and clamp ranges.
AUTO_RETRY_COUNT = (3, 1, 10)
AUTO_RETRY_MINUTES = (10, 1, 120)


def gemini_model() -> str:
    """The model every Gemini call uses: GEMINI_MODEL when it is a curated entry, else the first
    one, so a model Google retired that an older install still has saved never reaches the API."""

    model = os.environ.get("GEMINI_MODEL", "").strip()
    return model if model in GEMINI_MODELS else GEMINI_MODELS[0]


def gemini_auto_fallback() -> bool:
    """The legacy fallback switch, on unless set false; now only seeds the derived fallback list."""

    return os.environ.get("GEMINI_AUTO_FALLBACK", "").strip().lower() not in _FALSY


def gemini_fallback_models(main: str | None = None) -> list[str]:
    """The ordered models a 503 from `main` (default: the selected model) falls back to.
    Read from GEMINI_FALLBACK_MODELS (`,`-joined, `none` = empty); uncurated ids, `main` and duplicates drop."""

    main = main or gemini_model()
    raw = os.environ.get("GEMINI_FALLBACK_MODELS", "").strip()
    if raw:
        ids = [] if raw == _NO_FALLBACK else [i.strip() for i in raw.split(",")]
    elif not gemini_auto_fallback():
        # Migration: derive the list for installs that never saved one; see docs/MIGRATIONS.md.
        ids = []
    else:
        at = GEMINI_MODELS.index(main) if main in GEMINI_MODELS else -1
        ids = GEMINI_MODELS[at + 1 :] + GEMINI_MODELS[: at + 1]
    out: list[str] = []
    for i in ids:
        if i in GEMINI_MODELS and i != main and i not in out:
            out.append(i)
    return out


def auto_run() -> str:
    """The automatic-work ceiling: AUTO_RUN, else `full`. An unrecognised value means `full` too,
    so a typo can never silently stop every unattended run."""

    mode = os.environ.get("AUTO_RUN", "").strip().lower()
    return mode if mode in AUTO_RUN_MODES else "full"


def auto_remove() -> str:
    """Which intermediates auto-remove deletes: AUTO_REMOVE, else `off`. Unlike auto_run(), an
    unrecognised value means `off`, since a typo must never delete files."""

    mode = os.environ.get("AUTO_REMOVE", "").strip().lower()
    return mode if mode in AUTO_REMOVE_MODES else "off"


def auto_remove_after() -> str | None:
    """The point a lecture's intermediates become removable: AUTO_REMOVE_AFTER, else None,
    which removes nothing."""

    point = os.environ.get("AUTO_REMOVE_AFTER", "").strip().lower()
    return point if point in AUTO_REMOVE_AFTER else None


def drive_enabled() -> bool:
    """Whether the Drive upload step runs. Opt-in: unset means off, so an install that
    never configured Drive completes each lecture at its PDF."""

    return os.environ.get("DRIVE_ENABLED", "").strip().lower() in _TRUTHY


def summary_figures() -> bool:
    """Whether a lecture or recitation summary carries the slides' graphs. Opt-in: unset means off."""

    return os.environ.get("SUMMARY_FIGURES", "").strip().lower() in _TRUTHY


def auto_retry() -> bool:
    """Whether a step that failed transiently on Gemini re-runs itself. On unless set false."""

    return os.environ.get("AUTO_RETRY", "").strip().lower() not in _FALSY


def _clamped_int(key: str, spec: tuple[int, int, int]) -> int:
    default, low, high = spec
    try:
        value = int(os.environ.get(key, "").strip())
    except ValueError:
        return default
    return max(low, min(high, value))


def auto_retry_count() -> int:
    """How many re-runs follow the original failure: AUTO_RETRY_COUNT clamped to 1-10, default 3."""

    return _clamped_int("AUTO_RETRY_COUNT", AUTO_RETRY_COUNT)


def auto_retry_minutes() -> int:
    """Minutes between re-runs: AUTO_RETRY_MINUTES clamped to 1-120, default 10."""

    return _clamped_int("AUTO_RETRY_MINUTES", AUTO_RETRY_MINUTES)


def apply_config(values: dict) -> list[str]:
    """Write the given settings into the process environment; returns the field names
    applied. Values are never logged — one of them is an API key."""

    applied = []
    for field, value in values.items():
        env_key = _ENV_KEYS.get(field)
        if env_key is None:
            continue
        if field == "gemini_fallback_models":
            # null is "never saved": drop the var so the derived default applies again.
            if value is None:
                os.environ.pop(env_key, None)
            else:
                os.environ[env_key] = ",".join(value) or _NO_FALLBACK
            applied.append(field)
            continue
        if value is None:
            continue
        os.environ[env_key] = (
            str(value).lower() if isinstance(value, bool) else str(value)
        )
        applied.append(field)
    return applied
