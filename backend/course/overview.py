"""Course-level overview registry. Pure registry: it declares extractors and their phase
chains but imports NO worker module (extract/analyze/collect/to_pdf import this back — a
worker import here would be a cycle). Phase order + on-disk suffix are intrinsic to `Phase`
and each extractor's `phases` tuple; there is no global phase-order table."""

from dataclasses import dataclass
from enum import Enum
from typing import ClassVar


class Phase(Enum):
    """A pipeline phase as a value type: its wire/CSV id plus its on-disk output suffix.
    Extractors declare ordered tuples of these; the runner dispatches on the members."""
    EXTRACT = ("extract", ".txt")
    ANALYZE = ("analyze", ".md")
    TOPICS  = ("topics",  ".md")
    TO_PDF  = ("to_pdf",  ".pdf")

    def __init__(self, id: str, suffix: str):
        self.id = id          # wire/status/CSV string identifier
        self.suffix = suffix  # on-disk output suffix for this phase

    @classmethod
    def from_id(cls, id: str) -> "Phase | None":
        return _PHASE_BY_ID.get(id)


_PHASE_BY_ID = {p.id: p for p in Phase}


@dataclass(frozen=True)
class Extractor:
    """Base extractor identity. `phases` lives on the class (behavior, not per-instance
    data): each subclass declares which pipeline phases it participates in, in order."""
    slug: str                        # kebab-case stable id: output file stem, status key, API/CSV identifier
    title: str                       # human-readable display name (UI + report header only)

    phases: ClassVar[tuple[Phase, ...]] = ()

    def phases_from(self, from_phase: "Phase | None") -> tuple[Phase, ...]:
        """The sub-chain to run: this extractor's phases starting at `from_phase`.
        None → the full chain. A `from_phase` this extractor doesn't declare → the full chain too
        (it's upstream of / irrelevant to this extractor — e.g. a default full run reaching the
        topics extractor, which has no EXTRACT/ANALYZE phase). In practice `from_phase` is either
        None (gen-all) or one of THIS extractor's phases (single-slug ↺), so the fallback is defensive."""
        if from_phase is None or from_phase not in self.phases:
            return self.phases
        return self.phases[self.phases.index(from_phase):]

    def output_file(self, phase: Phase) -> str:
        """On-disk output filename for one of this extractor's phases (e.g. 'exam-hints.txt')."""
        return f"{self.slug}{phase.suffix}"


@dataclass(frozen=True)
class PatternExtractor(Extractor):
    """Transcript-pattern extractor: extract snippets → analyze with LLM → render PDF."""
    patterns: tuple[str, ...] = ()   # regexes matched per sentence
    before: int = 1                  # sentences kept before a match
    after: int = 3                   # sentences kept after a match

    phases: ClassVar[tuple[Phase, ...]] = (Phase.EXTRACT, Phase.ANALYZE, Phase.TO_PDF)

    @property
    def prompt_file(self) -> str:
        return f"{self.slug}.md"


@dataclass(frozen=True)
class ImmediateExtractor(Extractor):
    """Without third-parties: builds its markdown directly from lecture summaries in the
    `topics` phase, then reuses the shared to_pdf phase to render a PDF."""

    phases: ClassVar[tuple[Phase, ...]] = (Phase.TOPICS, Phase.TO_PDF)


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
