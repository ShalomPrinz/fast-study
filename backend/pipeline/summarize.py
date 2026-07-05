from pathlib import Path

from services.llm_client import LLMClient
from timing import timed_pipeline

PROMPT_FILE = Path(__file__).parent.parent / "assets" / "instructions" / "summarize.md"

MODEL = "gemini-3.5-flash"

# Appended to every request — keeps the page budget tunable without editing the prompt file.
LENGTH_BUDGET_SUFFIX = (
    "\n\nLENGTH BUDGET: aim for 2-4 PDF pages."
    "Never exceed 5 pages, and only approach 5 for unusually dense lectures."
    "If a draft is running long, tighten phrasing and drop filler before adding more content."
)

# Appended to the base prompt when a supplementary PDF is attached.
PDF_INSTRUCTION_SUFFIX = (
    "\n\nA supplementary PDF has been attached alongside the transcript. "
    "Cross-reference its contents with the transcript and incorporate relevant insights into the final summary."
)


@timed_pipeline("summarize")
def summarize(transcript_path: Path, material_path: Path | None = None) -> str:
    prompt = PROMPT_FILE.read_text(encoding="utf-8")

    client = LLMClient(model=MODEL)
    uploaded = []
    try:
        # Context first, instructions last
        transcript_file = client.upload_file(transcript_path, "text/plain")
        uploaded.append(transcript_file)

        contents: list = [
            "--- MAIN TRANSCRIPT DOCUMENT ---",
            transcript_file,
        ]

        if material_path is not None:
            material_file = client.upload_file(material_path, "application/pdf")
            uploaded.append(material_file)
            contents += ["--- SUPPLEMENTARY PDF DOCUMENT ---", material_file]
            prompt += PDF_INSTRUCTION_SUFFIX

        prompt += LENGTH_BUDGET_SUFFIX
        contents += ["--- INSTRUCTIONS ---", prompt]

        return client.generate(contents)
    finally:
        # Clean up uploaded files
        for handle in uploaded:
            client.delete_file(handle.name)
