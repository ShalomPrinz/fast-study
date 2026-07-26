"""Tests for course/ranges.py — name_range snapshots a source set's numeric min–max."""

from course.ranges import name_range


class TestNameRange:
    def test_plain_min_max(self):
        assert name_range(["Lecture 2", "Lecture 5", "Lecture 9"]) == {
            "start": "2",
            "end": "9",
        }

    def test_single_entry(self):
        assert name_range(["Lecture 4"]) == {"start": "4", "end": "4"}

    def test_non_contiguous_is_plain_min_max(self):
        # 2,3,7 has a gap — no contiguity check, just min..max.
        assert name_range(["Lecture 3", "Lecture 7", "Lecture 2"]) == {
            "start": "2",
            "end": "7",
        }

    def test_dotted_sub_numbers_natural_sorted(self):
        # 2.10 must sort AFTER 2.2 (int tuple, not string): min 2.2, max 11.3.
        names = ["Lecture 2.10", "Lecture 2.2", "Lecture 11.3"]
        assert name_range(names) == {"start": "2.2", "end": "11.3"}

    def test_mixed_depth_2_vs_2_2(self):
        # "2" -> [2] sorts before "2.2" -> [2, 2]; whole-number 3 is the max.
        assert name_range(["Lecture 2.2", "Lecture 2", "Lecture 3"]) == {
            "start": "2",
            "end": "3",
        }

    def test_empty_is_none(self):
        assert name_range([]) is None

    def test_names_without_number_dropped(self):
        assert name_range(["Intro", "Lecture 5", "Overview"]) == {
            "start": "5",
            "end": "5",
        }

    def test_all_names_without_number_is_none(self):
        assert name_range(["Intro", "Overview"]) is None

    def test_first_dotted_token_only(self):
        # Only the first numeric token counts, even if trailing text has more digits.
        assert name_range(["Lecture 4 part 2"]) == {"start": "4", "end": "4"}
