"""The API-key provider table and the key probe behind POST /config/probe-key. One row
per provider holds the language-neutral facts; the prose that goes around them lives in
the frontend's locale catalogs."""

import logging

import requests

log = logging.getLogger("providers")

PROBE_TIMEOUT_SECONDS = 8  # a dead network must not hang the settings field

# Both SDK clients get base_url explicitly, so no ambient variable can redirect a call. The
# probe (base_url + probe_path) lists models: zero tokens, and no per-model quota touched.
PROVIDERS = {
    "groq": {
        "display_name": "Groq",
        "key_prefix": "gsk_",
        "base_url": "https://api.groq.com",
        "probe_path": "/openai/v1/models",
        "auth_header": "Authorization",
        "auth_value": "Bearer {key}",
        "console_url": "https://console.groq.com/keys",
    },
    "gemini": {
        "display_name": "Gemini",
        "key_prefix": "AIza",
        "base_url": "https://generativelanguage.googleapis.com/",
        "probe_path": "v1beta/models",
        "auth_header": "x-goog-api-key",
        "auth_value": "{key}",
        "console_url": "https://aistudio.google.com/apikey",
    },
}

# The base URL, probe path and auth shape stay server-side; the rest is what a field renders.
PUBLIC_FIELDS = ("display_name", "key_prefix", "console_url")


def public_providers() -> list[dict]:
    """The provider rows as the frontend sees them, id included."""

    return [
        {"id": pid, **{field: row[field] for field in PUBLIC_FIELDS}}
        for pid, row in PROVIDERS.items()
    ]


def base_url(provider: str) -> str:
    """The one base URL every request to this provider is built on."""

    return PROVIDERS[provider]["base_url"]


def probe_key(provider: str, key: str) -> str:
    """Authenticate one key against its provider's list-models endpoint.
    Returns "valid" | "rejected" | "unverified" — only an explicit 401/403 is a rejection,
    since an unreachable provider must never report a good key as bad."""

    row = PROVIDERS[provider]
    try:
        response = requests.get(
            row["base_url"] + row["probe_path"],
            headers={row["auth_header"]: row["auth_value"].format(key=key)},
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        # Only the exception class: a request's repr can carry the key's headers.
        log.info("%s key probe unreachable: %s", provider, type(e).__name__)
        return "unverified"

    if 200 <= response.status_code < 300:
        return "valid"
    if response.status_code in (401, 403):
        return "rejected"
    log.info("%s key probe inconclusive: HTTP %s", provider, response.status_code)
    return "unverified"
