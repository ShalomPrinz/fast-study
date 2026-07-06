"""Course-level overview registry."""

from dataclasses import dataclass


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
