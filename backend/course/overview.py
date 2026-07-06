"""Course-level overview extraction: scan every transcript for purpose-specific snippets
(e.g. exam hints), assemble a per-extractor report, and optionally send it to an LLM for analysis."""

import re
from dataclasses import dataclass
from pathlib import Path

from services.llm_client import LLMClient

PROMPT_DIR = Path(__file__).parent.parent / "assets" / "instructions" / "overview"

MODEL = "gemini-3.5-flash"


@dataclass(frozen=True)
class Extractor:
    slug: str                        # kebab-case stable id: output file stem, status key, API/CSV identifier
    title: str                       # human-readable display name (UI + report header only)
    patterns: tuple[str, ...] = ()   # regexes matched per sentence
    before: int = 1                  # sentences kept before a match
    after: int = 3                   # sentences kept after a match

    @property
    def prompt_file(self) -> str:
        return f"{self.slug}.md"


EXTRACTORS: tuple[Extractor, ...] = (
    Extractor(
        slug="exam-hints",
        title="Exam Hints",
        patterns=(
            "במבחן", "בבחינה", "למבחן", "לבחינה", "שאלת מבחן", "חומר למבחן",
            "תזכרו", "חשוב מאוד", "אני מבטיח לכם", "שווה לזכור",
        ),
    ),
    Extractor(
        slug="student-qa",
        title="Student QA",
        patterns=(
            "שקט", r"ששש+", r"רגע,? רגע", "יש שאלה", "שאלה טובה", "שאלה מצוינת",
            "מה השאלה", "חוזר על השאלה", "בואו נשמע", "נשאלה שאלה", "תשאל", "שאל אותי",
        ),
    ),
    Extractor(
        slug="pitfalls",
        title="Pitfalls",
        patterns=(
            "טעות נפוצה", "טעות קלאסית", "אל תתבלבלו", "לא להתבלבל", "מתבלבלים",
            "שימו לב", "זהירות", "הרבה סטודנטים", "בטעות",
        ),
    ),
)

EXTRACTORS_BY_SLUG: dict[str, Extractor] = {e.slug: e for e in EXTRACTORS}


# A sentence is either a run ending in ./?/! (terminator kept attached) or a
# terminator-less trailing run. \n is excluded from both alternatives so
# newlines always act as boundaries; findall skips over them.
_SENTENCE_RE = re.compile(r"[^.?!\n]*[.?!]+|[^.?!\n]+")


def split_sentences(text: str) -> list[str]:
    """Split text into sentences on ./?/! and newlines, dropping blank ones."""
    return [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]


# Hebrew substring matching: prefixed forms (ו/ה/ש/ב) are covered by NOT anchoring patterns at word start.
def _pattern_snippets(extractor: Extractor, sentences: list[str]) -> list[str]:
    compiled = [(p, re.compile(p)) for p in extractor.patterns]

    # One window per matched sentence, clamped to the transcript bounds.
    # `before` is constant, so windows come out already sorted by start.
    windows: list[list] = []  # [start, end, [patterns]]
    for i, sent in enumerate(sentences):
        hit = [p for p, rx in compiled if rx.search(sent)]
        if hit:
            windows.append([max(0, i - extractor.before), min(len(sentences) - 1, i + extractor.after), hit])

    # Merge overlapping/adjacent windows so clustered matches yield one snippet.
    merged: list[list] = []
    for start, end, pats in windows:
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
            merged[-1][2].extend(pats)
        else:
            merged.append([start, end, list(pats)])

    snippets = []
    for start, end, pats in merged:
        uniq = list(dict.fromkeys(pats))  # dedupe, keep first-hit order
        text = " ".join(sentences[start:end + 1])
        snippets.append(f"--- [patterns: {', '.join(uniq)}] ---\n{text}")
    return snippets


def extract_snippets(extractor: Extractor, transcript: str) -> list[str]:
    """Extract annotated snippet blocks ('--- [...] ---\\n{text}') from one transcript."""
    sentences = split_sentences(transcript)
    if not sentences:
        return []
    return _pattern_snippets(extractor, sentences)


def build_report(extractor: Extractor, course: str, sections: list[tuple[str, list[str]]]) -> str:
    """Assemble the report from (source label, snippets) sections. Sources with zero
    snippets are omitted; returns "" when all are empty so callers can skip the write."""
    non_empty = [(label, snips) for label, snips in sections if snips]
    if not non_empty:
        return ""
    parts = [
        f"# {course}: {extractor.title}",
        "",
    ]
    for label, snips in non_empty:
        parts.append(f"=== {label} ===")
        parts.append("")
        for snippet in snips:
            parts.append(snippet)
            parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def analyze(extractor: Extractor, report: str, course: str) -> str:
    """Send one extractor's report to an LLM with its prompt. Raises RuntimeError on API failure."""
    prompt = (PROMPT_DIR / extractor.prompt_file).read_text(encoding="utf-8")
    client = LLMClient(model=MODEL)
    return client.generate([prompt, f"Course: {course}", report])
