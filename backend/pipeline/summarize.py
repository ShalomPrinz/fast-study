from pathlib import Path

from google import genai

from services.google_auth import get_credentials
from timing import timed_pipeline

PROMPT_FILE = Path(__file__).parent.parent / "assets" / "instructions" / "summarize.md"

MODEL = "gemini-3.1-pro-preview"


def _build_client() -> genai.Client:
    creds = get_credentials("gemini")
    return genai.Client(credentials=creds)


@timed_pipeline("summarize")
def summarize(transcript_path: Path, material_path: Path | None = None) -> str:
    prompt = PROMPT_FILE.read_text(encoding="utf-8")

    try:
        client = _build_client()

        transcript_file = client.files.upload(
            file=str(transcript_path),
            config={"mime_type": "text/plain"},
        )

        contents = [prompt, transcript_file]
        if material_path is not None:
            material_file = client.files.upload(
                file=str(material_path),
                config={"mime_type": "application/pdf"},
            )
            contents.append(material_file)

        response = client.models.generate_content(
            model=MODEL,
            contents=contents,
        )
    except Exception as e:
        raise RuntimeError(str(e)) from e

    return (response.text or "").strip()
