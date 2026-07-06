"""Overview analyze phase: send one extractor's snippet report to Gemini with its prompt, and
the phase worker the runner drives — read {slug}.txt, analyze, write {slug}.md. A
missing .txt just skips. Pure work — the runner owns loop/status/notify/failure isolation."""

from pathlib import Path

from course.overview import Extractor
from services import db_client
from services.llm_client import LLMClient

PROMPT_DIR = Path(__file__).parent.parent / "assets" / "instructions" / "overview"

MODEL = "gemini-3.5-flash"


def analyze(extractor: Extractor, report: str, course: str) -> str:
    """Send one extractor's report to an LLM with its prompt. Raises RuntimeError on API failure."""
    prompt = (PROMPT_DIR / extractor.prompt_file).read_text(encoding="utf-8")
    client = LLMClient(model=MODEL)
    return client.generate([prompt, f"Course: {course}", report])


def run_analyze(course: str, extractor: Extractor) -> dict:
    """Analyze one extractor's snippet report; write {slug}.md. Returns a status dict
    ("skipped"/"done"); raises on Gemini/I/O failure so the runner records it as "error"."""
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
