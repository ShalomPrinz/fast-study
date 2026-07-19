"""Shared Gemini (google-genai) client for the summarize step and the course overview
analysis: GEMINI_API_KEY auth, stripped replies, and SDK failures surfaced as RuntimeError
(429s as GeminiRateLimitError) so endpoints can return {"status": "error"}."""

import os
import re

from google import genai

DEFAULT_MODEL = "gemini-3.5-flash"


class GeminiRateLimitError(RuntimeError):
    """A 429 from Gemini; info = {quota_id, quota_value, model, is_daily}."""

    def __init__(self, info: dict):
        self.info = info
        super().__init__(info["message"])


def _extract_gemini_body(err: Exception) -> dict:
    """Dig the JSON error body out of a google-genai SDK exception."""

    for attr in ("details", "body"):
        value = getattr(err, attr, None)
        if isinstance(value, dict):
            return value
    try:
        return err.response.json()
    except Exception:
        return {}


def _is_rate_limit(err: Exception, body: dict) -> bool:
    """True when the SDK error is a 429 / RESOURCE_EXHAUSTED, however it is shaped."""

    if getattr(err, "code", None) == 429:
        return True
    inner = body.get("error", body)
    if isinstance(inner, dict) and (inner.get("code") == 429 or inner.get("status") == "RESOURCE_EXHAUSTED"):
        return True
    return "RESOURCE_EXHAUSTED" in str(err)


def _detail(inner: dict, type_suffix: str) -> dict:
    """Find one entry of the error body's `details` list by its @type suffix."""

    for entry in inner.get("details") or []:
        if isinstance(entry, dict) and str(entry.get("@type", "")).endswith(type_suffix):
            return entry
    return {}


def parse_gemini_rate_limit(body: dict, fallback_text: str = "") -> dict:
    """Pull the quota facts out of a 429 body, falling back to regex over the raw error text.
    Only an explicit per-minute quotaId is waitable — an unknown one is assumed daily, since
    sleeping an hour on a quota that returns at midnight is the worse failure."""

    inner = body.get("error", body) if isinstance(body, dict) else {}
    if not isinstance(inner, dict):
        inner = {}

    violation = ((_detail(inner, "QuotaFailure").get("violations") or [{}]) or [{}])[0]
    quota_id = violation.get("quotaId")
    quota_value = violation.get("quotaValue")
    model = (violation.get("quotaDimensions") or {}).get("model")

    text = fallback_text or str(inner.get("message") or "")
    if quota_id is None:
        m = re.search(r"['\"]quotaId['\"]:\s*['\"]([^'\"]+)['\"]", text)
        quota_id = m.group(1) if m else None
    if quota_value is None:
        m = re.search(r"['\"]quotaValue['\"]:\s*['\"]?(\d+)", text)
        quota_value = m.group(1) if m else None

    return {
        "quota_id": quota_id,
        "quota_value": int(quota_value) if str(quota_value or "").isdigit() else None,
        "model": model,
        "is_daily": "PerMinute" not in (quota_id or ""),
    }


def _quota_message(info: dict, model: str) -> str:
    """One readable line replacing the SDK's multi-hundred-character JSON blob."""

    name = info.get("model") or model
    tier = "free-tier " if "FreeTier" in (info.get("quota_id") or "") else ""
    if info["is_daily"]:
        limit = f"{info['quota_value']} requests/day for {name}" if info.get("quota_value") else name
        return f"Gemini {tier}daily quota reached ({limit}) — resets at midnight Pacific"
    limit = f"{info['quota_value']} requests/min for {name}" if info.get("quota_value") else name
    return f"Gemini {tier}per-minute quota reached ({limit})"


class LLMClient:
    def __init__(self, *, model: str = DEFAULT_MODEL, api_key: str | None = None):
        # The Developer API path used here requires an API key; OAuth is Vertex-only.
        api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set in the environment")
        self.model = model
        self.client = genai.Client(api_key=api_key)

    def generate(self, contents: list) -> str:
        """Send contents to the model and return its stripped text."""

        try:
            response = self.client.models.generate_content(model=self.model, contents=contents)
        except Exception as e:
            body = _extract_gemini_body(e)
            if _is_rate_limit(e, body):
                info = parse_gemini_rate_limit(body, str(e))
                info["message"] = _quota_message(info, self.model)
                raise GeminiRateLimitError(info) from e
            raise RuntimeError(str(e)) from e
        return (response.text or "").strip()

    def upload_file(self, path, mime_type: str):
        """Upload a local file as a reusable content part. Raises RuntimeError on failure."""

        try:
            return self.client.files.upload(file=str(path), config={"mime_type": mime_type})
        except Exception as e:
            raise RuntimeError(str(e)) from e

    def delete_file(self, name: str) -> None:
        """Best-effort cleanup of server-side upload quota; swallows errors."""

        try:
            self.client.files.delete(name=name)
        except Exception:
            pass
