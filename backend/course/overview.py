"""Course-level overview registry."""

from dataclasses import dataclass
from typing import ClassVar


@dataclass(frozen=True)
class Extractor:
    """Base extractor identity. `phases` lives on the class (behavior, not per-instance
    data): each subclass declares which pipeline phases it participates in."""
    slug: str                        # kebab-case stable id: output file stem, status key, API/CSV identifier
    title: str                       # human-readable display name (UI + report header only)

    phases: ClassVar[tuple[str, ...]] = ()


@dataclass(frozen=True)
class PatternExtractor(Extractor):
    """Transcript-pattern extractor: extract snippets → analyze with LLM → render PDF."""
    patterns: tuple[str, ...] = ()   # regexes matched per sentence
    before: int = 1                  # sentences kept before a match
    after: int = 3                   # sentences kept after a match

    phases: ClassVar[tuple[str, ...]] = ("extract", "analyze", "to_pdf")

    @property
    def prompt_file(self) -> str:
        return f"{self.slug}.md"


@dataclass(frozen=True)
class ImmediateExtractor(Extractor):
    """Without third-parties: builds its markdown directly from lecture summaries in the
    `topics` phase, then reuses the shared to_pdf phase to render a PDF."""

    phases: ClassVar[tuple[str, ...]] = ("topics", "to_pdf")


EXTRACTORS: tuple[Extractor, ...] = (
    PatternExtractor(
        slug="exam-hints",
        title="Exam Hints",
        patterns=(
            "במבחן", "בבחינה", "למבחן", "לבחינה", "שאלת מבחן", "חומר למבחן",
            "תזכרו", "חשוב מאוד", "אני מבטיח לכם", "שווה לזכור",
        ),
    ),
    PatternExtractor(
        slug="student-qa",
        title="Student QA",
        patterns=(
            "שקט", r"ששש+", r"רגע,? רגע", "יש שאלה", "שאלה טובה", "שאלה מצוינת",
            "מה השאלה", "חוזר על השאלה", "בואו נשמע", "נשאלה שאלה", "תשאל", "שאל אותי",
        ),
    ),
    PatternExtractor(
        slug="pitfalls",
        title="Pitfalls",
        patterns=(
            "טעות נפוצה", "טעות קלאסית", "אל תתבלבלו", "לא להתבלבל", "מתבלבלים",
            "שימו לב", "זהירות", "הרבה סטודנטים", "בטעות",
        ),
    ),
    ImmediateExtractor(slug="topics", title="Topics"),
)

EXTRACTORS_BY_SLUG: dict[str, Extractor] = {e.slug: e for e in EXTRACTORS}

ALL_SLUGS = [e.slug for e in EXTRACTORS]
