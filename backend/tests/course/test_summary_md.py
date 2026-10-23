"""Tests for course/summary_md.py's overview ordering — merged_key and ordered_entries."""

from course.summary_md import merged_key, ordered_entries


def _order(items):
    return [n for n, k in sorted(items, key=lambda t: merged_key(*t))]


class TestMergedKey:
    def test_lecture_before_recitation_on_same_number(self):
        items = [
            ("Recitation 1", "recitation"),
            ("Lecture 2", "lecture"),
            ("Lecture 1", "lecture"),
        ]
        assert _order(items) == ["Lecture 1", "Recitation 1", "Lecture 2"]

    def test_numbers_compare_numerically_and_dotted(self):
        items = [
            ("Lecture 10", "lecture"),
            ("Recitation 2.2", "recitation"),
            ("Lecture 2", "lecture"),
        ]
        assert _order(items) == ["Lecture 2", "Recitation 2.2", "Lecture 10"]

    def test_whole_number_then_kind_then_sub(self):
        items = [
            ("L 4", "lecture"),
            ("R 3", "recitation"),
            ("L 3.2", "lecture"),
            ("L 3.1", "lecture"),
        ]
        assert _order(items) == ["L 3.1", "L 3.2", "R 3", "L 4"]

    def test_only_trailing_number_counts(self):
        # A number mid-name is prefix; with nothing trailing the name is unnumbered.
        items = [
            ("Part 2 Lecture 5", "lecture"),
            ("Lecture 3", "lecture"),
            ("2024 review", "lecture"),
        ]
        assert _order(items) == ["Lecture 3", "Part 2 Lecture 5", "2024 review"]

    def test_unnumbered_after_numbered_by_name(self):
        items = [
            ("Summary", "lecture"),
            ("Intro", "recitation"),
            ("Recitation 9", "recitation"),
        ]
        assert _order(items) == ["Recitation 9", "Intro", "Summary"]


class TestOrderedEntries:
    LEC = [("Lecture 2", "a"), ("Lecture 1", "b")]
    REC = [("Recitation 1", "c")]

    def test_split_lectures_then_recitations(self):
        names = [n for n, _, _ in ordered_entries(self.LEC, self.REC, merged=False)]
        assert names == ["Lecture 1", "Lecture 2", "Recitation 1"]

    def test_merged_interleaves_and_keeps_kind(self):
        out = ordered_entries(self.LEC, self.REC, merged=True)
        assert [(n, k) for n, k, _ in out] == [
            ("Lecture 1", "lecture"),
            ("Recitation 1", "recitation"),
            ("Lecture 2", "lecture"),
        ]
