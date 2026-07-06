"""Extraction logic tests — split_sentences / extract_snippets / build_report now live in
course/extract.py (moved out of overview.py, which is registry-only)."""

from course.overview import Extractor
from course.extract import split_sentences, extract_snippets, build_report


def _pattern_extractor(patterns, before=1, after=1, slug="test", title="Test"):
    return Extractor(slug=slug, title=title,
                     patterns=tuple(patterns), before=before, after=after)


class TestSplitSentences:
    def test_hebrew_blob_no_newlines(self):
        # Whisper output is a near-unbroken blob — ? and . both terminate sentences.
        text = "בשיעור שעבר למדנו על תהליכים נכון? ואז דיברנו על מבנה זיכרון. היום נמשיך הלאה"
        assert split_sentences(text) == [
            "בשיעור שעבר למדנו על תהליכים נכון?",
            "ואז דיברנו על מבנה זיכרון.",
            "היום נמשיך הלאה",
        ]

    def test_terminator_stays_attached(self):
        assert split_sentences("מה זה? זהו.") == ["מה זה?", "זהו."]

    def test_exclamation_and_repeated_terminators(self):
        assert split_sentences("שקט!! תודה.") == ["שקט!!", "תודה."]

    def test_newlines_are_boundaries(self):
        assert split_sentences("שורה ראשונה\nשורה שנייה. סוף") == [
            "שורה ראשונה", "שורה שנייה.", "סוף",
        ]

    def test_empty_and_whitespace_only(self):
        assert split_sentences("") == []
        assert split_sentences("  \n\n \t ") == []


class TestPatternWindowing:
    SENTS = [
        "משפט אפס.", "משפט אחד.", "כאן מופיע במבחן משהו.", "משפט שלוש.",
        "משפט ארבע.", "משפט חמש.", "משפט שש.",
    ]

    def test_window_around_match(self):
        ext = _pattern_extractor(["במבחן"], before=1, after=2)
        snippets = extract_snippets(ext, " ".join(self.SENTS))
        assert len(snippets) == 1
        header, text = snippets[0].split("\n", 1)
        assert header == "--- [patterns: במבחן] ---"
        assert text == "משפט אחד. כאן מופיע במבחן משהו. משפט שלוש. משפט ארבע."

    def test_clamp_at_start(self):
        ext = _pattern_extractor(["במבחן"], before=3, after=0)
        snippets = extract_snippets(ext, "כאן מופיע במבחן משהו. משפט אחד.")
        assert len(snippets) == 1
        assert snippets[0].endswith("\nכאן מופיע במבחן משהו.")

    def test_clamp_at_end(self):
        ext = _pattern_extractor(["במבחן"], before=0, after=5)
        snippets = extract_snippets(ext, "משפט אפס. כאן מופיע במבחן משהו. משפט שתיים.")
        assert len(snippets) == 1
        assert snippets[0].endswith("\nכאן מופיע במבחן משהו. משפט שתיים.")

    def test_overlapping_windows_merge_with_both_patterns(self):
        text = "משפט אפס. יש שאלה בקהל. משפט שתיים. שאלה טובה מאוד. משפט ארבע. משפט חמש."
        ext = _pattern_extractor(["יש שאלה", "שאלה טובה"], before=1, after=1)
        snippets = extract_snippets(ext, text)
        assert len(snippets) == 1
        header, text_out = snippets[0].split("\n", 1)
        assert header == "--- [patterns: יש שאלה, שאלה טובה] ---"
        assert text_out == "משפט אפס. יש שאלה בקהל. משפט שתיים. שאלה טובה מאוד. משפט ארבע."

    def test_adjacent_windows_merge(self):
        # Windows [0,1] and [2,3] touch with no gap sentence — one snippet, not two.
        text = "יש שאלה כאן. מילוי. יש שאלה שוב. מילוי נוסף."
        ext = _pattern_extractor(["יש שאלה"], before=0, after=1)
        assert len(extract_snippets(ext, text)) == 1

    def test_distant_matches_stay_separate(self):
        text = "יש שאלה כאן. אחד. שניים. שלושה. ארבעה. יש שאלה שוב. שישה."
        ext = _pattern_extractor(["יש שאלה"], before=0, after=0)
        snippets = extract_snippets(ext, text)
        assert len(snippets) == 2
        assert "יש שאלה כאן." in snippets[0]
        assert "יש שאלה שוב." in snippets[1]

    def test_repeated_pattern_annotated_once(self):
        text = "במבחן יהיה קשה. במבחן יהיה קל."
        ext = _pattern_extractor(["במבחן"], before=0, after=0)
        snippets = extract_snippets(ext, text)
        assert len(snippets) == 1
        assert snippets[0].startswith("--- [patterns: במבחן] ---\n")

    def test_no_match_returns_empty(self):
        ext = _pattern_extractor(["במבחן"])
        assert extract_snippets(ext, "אין כאן שום דבר רלוונטי.") == []
        assert extract_snippets(ext, "") == []

    def test_prefixed_form_matches_unanchored(self):
        # Hebrew prefixes (ו/ה/ש/ב) are covered because patterns aren't word-anchored.
        ext = _pattern_extractor(["למבחן"], before=0, after=0)
        assert len(extract_snippets(ext, "זה חשוב ולמבחן במיוחד.")) == 1


class TestBuildReport:
    EXT = _pattern_extractor(["במבחן"], slug="exam-hints", title="Exam Hints")

    def test_format(self):
        snippet = "--- [patterns: במבחן] ---\nזה יהיה במבחן."
        report = build_report(self.EXT, "מבני נתונים", [("Lecture 4", [snippet])])
        assert report == (
            "# מבני נתונים: Exam Hints\n"
            "\n"
            "=== Lecture 4 ===\n"
            "\n"
            "--- [patterns: במבחן] ---\n"
            "זה יהיה במבחן.\n"
        )

    def test_zero_snippet_source_omitted(self):
        snippet = "--- [patterns: במבחן] ---\nקטע."
        report = build_report(self.EXT, "קורס", [
            ("Lecture 1", []),
            ("Lecture 2", [snippet]),
            ("Recitations/תרגול 3", []),
        ])
        assert "Lecture 1" not in report
        assert "=== Lecture 2 ===" in report
        assert "תרגול 3" not in report

    def test_all_sources_empty_returns_empty_string(self):
        assert build_report(self.EXT, "קורס", [("Lecture 1", []), ("Lecture 2", [])]) == ""

    def test_recitation_label_appears_verbatim(self):
        snippet = "--- [patterns: במבחן] ---\nקטע."
        report = build_report(self.EXT, "קורס", [("Recitations/תרגול 3", [snippet])])
        assert "=== Recitations/תרגול 3 ===" in report
