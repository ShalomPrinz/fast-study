from pathlib import Path

from services.errors import CodedError
from services.llm_client import LLMClient
from services.resources import resource_path
from timing import timed_pipeline

PROMPT_FILE = resource_path("assets", "instructions", "summarize.md")
MATERIALS_PROMPT_FILE = resource_path(
    "assets", "instructions", "summarize_materials.md"
)

# Appended to every request — keeps the page budget tunable without editing the prompt file.
LENGTH_BUDGET_SUFFIX = (
    "\n\nLENGTH BUDGET: aim for 2-4 PDF pages."
    "Never exceed 5 pages, and only approach 5 for unusually dense lectures."
    "If a draft is running long, tighten phrasing and drop filler before adding more content."
)

# Appended to the base prompt when one or more supplementary PDFs are attached.
PDF_INSTRUCTION_SUFFIX = (
    "\n\nOne or more supplementary PDFs have been attached alongside the transcript. "
    "Cross-reference their contents with the transcript and incorporate relevant insights into the final summary."
)

TRANSCRIPT_MARKER = "--- MAIN TRANSCRIPT DOCUMENT ---"
SUPPLEMENTARY_MARKER = "--- SUPPLEMENTARY PDF DOCUMENTS ---"
LECTURE_MATERIALS_MARKER = "--- LECTURE MATERIAL PDF DOCUMENTS ---"
INSTRUCTIONS_MARKER = "--- INSTRUCTIONS ---"


def _generate(prompt: str, groups: list[tuple[str, list[tuple[Path, str]]]]) -> str:
    """Upload each (marker, [(path, mime)]) group under its one marker, then send the prompt
    last (context first, instructions last); every upload is deleted whatever the outcome."""

    client = LLMClient()
    uploaded = []
    try:
        contents: list = []
        for marker, files in groups:
            contents.append(marker)
            for path, mime_type in files:
                handle = client.upload_file(path, mime_type)
                uploaded.append(handle)
                contents.append(handle)
        contents += [INSTRUCTIONS_MARKER, prompt]
        return client.generate(contents)
    except CodedError:
        raise  # a quota hit or a missing key already names itself
    except Exception as e:
        raise CodedError(str(e), "summarization_failed", detail=str(e)) from e
    finally:
        for handle in uploaded:
            client.delete_file(handle.name)


@timed_pipeline("summarize")
def summarize(transcript_path: Path, material_paths: list[Path] | None = None) -> str:
    """Summarize a transcript (plus any number of material PDFs) with Gemini."""

    prompt = PROMPT_FILE.read_text(encoding="utf-8")
    groups = [(TRANSCRIPT_MARKER, [(transcript_path, "text/plain")])]
    if material_paths:
        groups.append(
            (SUPPLEMENTARY_MARKER, [(p, "application/pdf") for p in material_paths])
        )
        prompt += PDF_INSTRUCTION_SUFFIX
    return _generate(prompt + LENGTH_BUDGET_SUFFIX, groups)


@timed_pipeline("summarize_materials")
def summarize_materials(material_paths: list[Path]) -> str:
    """Summarize a lecture from its material PDFs alone, for one that has no recording."""

    prompt = MATERIALS_PROMPT_FILE.read_text(encoding="utf-8") + LENGTH_BUDGET_SUFFIX
    pdfs = [(p, "application/pdf") for p in material_paths]
    return _generate(prompt, [(LECTURE_MATERIALS_MARKER, pdfs)])
