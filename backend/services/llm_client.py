"""Shared Gemini (google-genai) client. Both the summarize step and the course
overview analysis talk to Gemini the same way — construct a client from
GEMINI_API_KEY, call generate_content, strip the reply, and surface SDK failures
as RuntimeError so endpoints can turn them into {"status": "error"}. Keep that
logic here, not duplicated per call site."""

import os

from google import genai

DEFAULT_MODEL = "gemini-3.5-flash"


class LLMClient:
    def __init__(self, *, model: str = DEFAULT_MODEL, api_key: str | None = None):
        # Developer API path used here requires an API key.
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
            raise RuntimeError(str(e)) from e
        return (response.text or "").strip()

    def upload_file(self, path, mime_type: str):
        """Upload a local file as a reusable content part. Raises RuntimeError on failure."""
        try:
            return self.client.files.upload(file=str(path), config={"mime_type": mime_type})
        except Exception as e:
            raise RuntimeError(str(e)) from e

    def delete_file(self, name: str) -> None:
        """Best-effort cleanup of server-side upload quota. Swallows errors"""
        try:
            self.client.files.delete(name=name)
        except Exception:
            pass
