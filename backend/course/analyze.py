"""Overview analyze phase: send one extractor's snippet report to Gemini with its prompt and
write the result. Pure work — the runner owns the loop, status and failure isolation."""

from pathlib import Path

from services import db_client
from services.llm_client import LLMClient

from course.overview import Extractor

PROMPT_DIR = Path(__file__).parent.parent / "assets" / "instructions" / "overview"


def analyze(extractor: Extractor, report: str, course: str) -> str:
    """Send one extractor's report to an LLM with its prompt. Raises RuntimeError on API failure."""

    prompt = (PROMPT_DIR / extractor.prompt_file).read_text(encoding="utf-8")
    client = LLMClient()
    return client.generate([prompt, f"Course: {course}", report])


def run_analyze(course: str, extractor: Extractor) -> dict:
    """Analyze one extractor's snippet report and write {slug}.md; a missing .txt skips.
    Raises on Gemini/I/O failure so the runner records it as "error"."""

    slug = extractor.slug
    try:
        report = db_client.get_overview_file(course, f"{slug}.txt").decode("utf-8")
    except db_client.DbClientError:
        return {"status": "skipped", "message": "no snippets file — run extract first"}
    analyzed = analyze(extractor, report, course)
    if not analyzed:
        raise RuntimeError("Gemini returned no text")
    db_client.put_overview_file(course, f"{slug}.md", analyzed.encode("utf-8"))
    return {"status": "done"}
