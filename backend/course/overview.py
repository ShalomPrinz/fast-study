"""Course-level overview registry: declares the extractors and their phase chains.

Imports NO worker module — extract/analyze/collect/to_pdf import this back, so a worker
import here would cycle. See docs/OVERVIEW.md."""

from dataclasses import dataclass
from enum import Enum
from typing import ClassVar


class Phase(Enum):
    """A phase as a value type: its wire/CSV id plus its on-disk output suffix."""

    EXTRACT = ("extract", ".txt")
    ANALYZE = ("analyze", ".md")
    TOPICS = ("topics", ".md")
    TO_PDF = ("to_pdf", ".pdf")

    def __init__(self, id: str, suffix: str):
        self.id = id  # wire/status/CSV string identifier
        self.suffix = suffix  # on-disk output suffix for this phase

    @classmethod
    def from_id(cls, id: str) -> "Phase | None":
        return _PHASE_BY_ID.get(id)


_PHASE_BY_ID = {p.id: p for p in Phase}


@dataclass(frozen=True)
class Extractor:
    """Base extractor identity. `phases` is a ClassVar because it's behavior, not
    per-instance data: each subclass declares the phases it participates in, in order."""

    slug: str  # kebab-case stable id: output file stem, status key, API/CSV identifier
    title: str  # human-readable display name (UI + report header only)

    phases: ClassVar[tuple[Phase, ...]] = ()

    @property
    def phase_ids(self) -> tuple[str, ...]:
        """The wire/CSV string ids of this extractor's phases, for serializing to the API."""

        return tuple(p.id for p in self.phases)

    def phases_from(self, from_phase: "Phase | None") -> tuple[Phase, ...]:
        """The sub-chain to run: this extractor's phases starting at `from_phase`. None, or a
        phase this extractor doesn't declare, falls back to the full chain."""

        if from_phase is None or from_phase not in self.phases:
            return self.phases
        return self.phases[self.phases.index(from_phase) :]

    def output_file(self, phase: Phase) -> str:
        """On-disk output filename for one of this extractor's phases (e.g. 'exam-hints.txt')."""

        return f"{self.slug}{phase.suffix}"


@dataclass(frozen=True)
class PatternExtractor(Extractor):
    """Transcript-pattern extractor: extract snippets → analyze with LLM → render PDF."""

    patterns: tuple[str, ...] = ()  # regexes matched per sentence
    before: int = 1  # sentences kept before a match
    after: int = 3  # sentences kept after a match

    phases: ClassVar[tuple[Phase, ...]] = (Phase.EXTRACT, Phase.ANALYZE, Phase.TO_PDF)

    @property
    def prompt_file(self) -> str:
        return f"{self.slug}.md"


@dataclass(frozen=True)
class ImmediateExtractor(Extractor):
    """Builds its markdown directly from the lecture summaries — no LLM — then reuses
    the shared to_pdf phase."""

    phases: ClassVar[tuple[Phase, ...]] = (Phase.TOPICS, Phase.TO_PDF)


EXTRACTORS: tuple[Extractor, ...] = (
    PatternExtractor(
        slug="exam-hints",
        title="Exam Hints",
        patterns=(
            "במבחן",
            "בבחינה",
            "למבחן",
            "לבחינה",
            "שאלת מבחן",
            "חומר למבחן",
            "תזכרו",
            "חשוב מאוד",
            "אני מבטיח לכם",
            "שווה לזכור",
        ),
    ),
    PatternExtractor(
        slug="student-qa",
        title="Student QA",
        patterns=(
            "שקט",
            r"ששש+",
            r"רגע,? רגע",
            "יש שאלה",
            "שאלה טובה",
            "שאלה מצוינת",
            "מה השאלה",
            "חוזר על השאלה",
            "בואו נשמע",
            "נשאלה שאלה",
            "תשאל",
            "שאל אותי",
        ),
    ),
    PatternExtractor(
        slug="pitfalls",
        title="Pitfalls",
        patterns=(
            "טעות נפוצה",
            "טעות קלאסית",
            "אל תתבלבלו",
            "לא להתבלבל",
            "מתבלבלים",
            "שימו לב",
            "זהירות",
            "הרבה סטודנטים",
            "בטעות",
        ),
    ),
    ImmediateExtractor(slug="topics", title="Topics"),
)

EXTRACTORS_BY_SLUG: dict[str, Extractor] = {e.slug: e for e in EXTRACTORS}

ALL_SLUGS = [e.slug for e in EXTRACTORS]
