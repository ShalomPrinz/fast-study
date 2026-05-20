from pathlib import Path

from google import genai

from services.google_auth import get_credentials
from timing import timed_pipeline

PROMPT_FILE = Path(__file__).parent.parent / "assets" / "instructions" / "summarize.md"

MODEL = "gemini-3.1-pro-preview"

# Appended to the base prompt when a supplementary PDF is attached.
PDF_INSTRUCTION_SUFFIX = (
    "\n\nA supplementary PDF has been attached alongside the transcript. "
    "Cross-reference its contents with the transcript and incorporate relevant insights into the final summary."
)


def _build_client() -> genai.Client:
    creds = get_credentials("gemini")
    return genai.Client(credentials=creds)


@timed_pipeline("summarize")
def summarize(transcript_path: Path, material_path: Path | None = None) -> str:
    prompt = PROMPT_FILE.read_text(encoding="utf-8")

    client = _build_client()
    uploaded = []
    try:
        # Context first, instructions last
        transcript_file = client.files.upload(
            file=str(transcript_path),
            config={"mime_type": "text/plain"},
        )
        uploaded.append(transcript_file)

        contents: list = [
            "--- MAIN TRANSCRIPT DOCUMENT ---",
            transcript_file,
        ]

        if material_path is not None:
            material_file = client.files.upload(
                file=str(material_path),
                config={"mime_type": "application/pdf"},
            )
            uploaded.append(material_file)
            contents += ["--- SUPPLEMENTARY PDF DOCUMENT ---", material_file]
            prompt += PDF_INSTRUCTION_SUFFIX

        contents += ["--- INSTRUCTIONS ---", prompt]

        response = client.models.generate_content(model=MODEL, contents=contents)
    except Exception as e:
        raise RuntimeError(str(e)) from e
    finally:
        # Uploaded files persist server-side until deleted; clean up to avoid
        # leaking quota. Swallow delete errors — the original exception wins.
        for handle in uploaded:
            try:
                client.files.delete(name=handle.name)
            except Exception:
                pass

    return (response.text or "").strip()
