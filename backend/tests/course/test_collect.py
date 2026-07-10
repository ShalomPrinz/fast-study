"""Tests for course/collect.py — the topics-phase parser/formatter and run_collect worker.

Pure helpers (parse_summary, _natural_key, _display_name, build_topics_md) are exercised
directly; run_collect is driven with db_client mocked (no network). Topics are HEADERS ONLY
(H2 topics + H3 subtopics) — no list-item collection."""

from course.collect import (
    RLM,
    _display_name,
    _natural_key,
    build_topics_md,
    parse_summary,
    render_entry,
    run_collect,
)
from services import db_client


class TestHeadingParse:
    def test_rlm_stripped_from_heading_text(self):
        # summarize.md writes "## ‏text" (RLM after the #s); the captured topic must be clean.
        md = f"# {RLM}הכותרת\n\n## {RLM}נושא\n"
        parsed = parse_summary(md)
        assert parsed["title"] == "הכותרת"
        assert parsed["topics"][0]["title"] == "נושא"
        assert RLM not in parsed["title"]

    def test_first_h1_is_title(self):
        md = "# First\n\n## נושא\n\n# Second\n"
        assert parse_summary(md)["title"] == "First"

    def test_heading_without_rlm_still_parses(self):
        md = "# Title\n\n## Topic\n"
        parsed = parse_summary(md)
        assert parsed["title"] == "Title"
        assert parsed["topics"][0]["title"] == "Topic"


class TestBuiltinExclusion:
    def test_builtin_h2_and_its_whole_section_skipped(self):
        # תקציר is a built-in: its H3 must not leak into topics either.
        md = (
            f"# {RLM}כותרת\n\n"
            f"## {RLM}תקציר\n\n### {RLM}תת של תקציר\n\nטקסט\n\n"
            f"## {RLM}נושא אמיתי\n\nטקסט\n"
        )
        parsed = parse_summary(md)
        assert [t["title"] for t in parsed["topics"]] == ["נושא אמיתי"]
        assert parsed["topics"][0]["subtopics"] == []

    def test_all_builtins_excluded(self):
        md = "# T\n\n## תקציר\n\n## הערות אישיות והדגשות המרצה\n\n## סיכום\n\n## משימות נדרשות\n"
        assert parse_summary(md)["topics"] == []


class TestNesting:
    def test_h2_topic_with_h3_subtopics(self):
        md = (
            "# T\n\n"
            "## נושא\n\n"
            "פסקה כלשהי\n\n"
            "### תת נושא\n\n"
            "עוד פסקה\n"
        )
        topic = parse_summary(md)["topics"][0]
        assert topic["title"] == "נושא"
        assert [s["title"] for s in topic["subtopics"]] == ["תת נושא"]

    def test_h3_before_any_h2_is_dropped(self):
        # An H3 with no parent H2 has nowhere to nest → ignored.
        md = "# T\n\n### תת יתום\n\n## נושא\n"
        parsed = parse_summary(md)
        assert [t["title"] for t in parsed["topics"]] == ["נושא"]
        assert parsed["topics"][0]["subtopics"] == []


class TestCodeFenceSkipped:
    def test_heading_inside_code_fence_is_ignored(self):
        # A "## ..." line inside ``` is code, not a heading — it must not become a topic.
        md = "# T\n\n## נושא\n\n```\n## fake heading\n```\n\nטקסט\n"
        assert [t["title"] for t in parse_summary(md)["topics"]] == ["נושא"]


class TestNaturalKey:
    def test_lecture_2_2_before_10_1(self):
        names = ["Lecture 10.1", "Lecture 2.2", "Lecture 2.10", "Lecture 2.2"]
        assert sorted(names, key=_natural_key) == [
            "Lecture 2.2", "Lecture 2.2", "Lecture 2.10", "Lecture 10.1",
        ]


class TestDisplayName:
    def test_lecture_translated_to_hebrew(self):
        assert _display_name("Lecture 5.2", "lecture") == "הרצאה 5.2"

    def test_recitation_translated_to_hebrew(self):
        assert _display_name("Recitation 3.1", "recitation") == "תרגול 3.1"

    def test_unknown_kind_left_as_is(self):
        assert _display_name("Lecture 5.2", "other") == "Lecture 5.2"


class TestBuildTopicsMd:
    LEC = ("Lecture 5.2", "# ‏מרוצי נתונים\n\n## ‏נושא\n")
    REC = ("Recitation 3.1", "# ‏חזרה\n\n## ‏נושא תרגול\n")

    def test_recitations_after_divider(self):
        md = build_topics_md([self.LEC], [self.REC])
        assert "\n---\n" in md
        assert md.index("הרצאה 5.2") < md.index("---") < md.index("תרגול 3.1")

    def test_no_divider_without_recitations(self):
        md = build_topics_md([self.LEC], [])
        assert "---" not in md

    def test_lectures_natural_sorted_by_english_name(self):
        # Sort keys off the English name (2.2 < 10.1) even though display is Hebrew הרצאה.
        a = ("Lecture 10.1", "# A\n\n## TA\n")
        b = ("Lecture 2.2", "# B\n\n## TB\n")
        md = build_topics_md([a, b], [])
        assert md.index("הרצאה 2.2") < md.index("הרצאה 10.1")

    def test_no_list_bullets_only_headers(self):
        # A summary with lists must yield header topics only — no list-derived bullets.
        lec = ("Lecture 1", "# T\n\n## נושא\n\n1. **פריט ממוספר**: הסבר\n\n* פריט שני\n")
        md = build_topics_md([lec], [])
        assert "פריט ממוספר" not in md
        assert "פריט שני" not in md
        assert f"- {RLM}נושא" in md.split("\n")


class TestRenderEntry:
    def test_hebrew_entry_heading_and_rlm(self):
        md = render_entry("Lecture 5.2", "lecture", "# ‏כותרת עברית\n\n## ‏נושא\n")
        lines = md.split("\n")
        assert lines[0] == f"# {RLM}הרצאה 5.2"        # Hebrew label → RLM after marker
        assert lines[1] == f"## {RLM}כותרת עברית"      # H1 title, Hebrew → RLM
        assert f"- {RLM}נושא" in lines                 # topic bullet at indent 0

    def test_recitation_entry_heading(self):
        md = render_entry("Recitation 3.1", "recitation", "# ‏חזרה\n\n## ‏נושא\n")
        assert md.split("\n")[0] == f"# {RLM}תרגול 3.1"

    def test_summary_with_only_builtins_gives_block_with_no_bullets(self):
        md = render_entry("Lecture 1", "lecture", "# ‏כותרת\n\n## ‏תקציר\n\nטקסט\n\n## ‏סיכום\n\nעוד\n")
        assert md == f"# {RLM}הרצאה 1\n## {RLM}כותרת"

    def test_nested_h3_subtopic_indent(self):
        md = render_entry("Lecture 1", "lecture", "# T\n\n## נושא\n\n### תת\n")
        lines = md.split("\n")
        assert f"- {RLM}נושא" in lines          # H2 topic at indent 0
        assert f"  - {RLM}תת" in lines          # H3 subtopic at indent 2


class TestRunCollect:
    COURSE = "קורס"

    def _node(self, lectures=(), recitations=()):
        def entry(name, has_summary):
            return {"name": name, "files": {"summary.md": {"exists": has_summary}}}
        return {
            "name": self.COURSE,
            "lectures": [entry(n, h) for n, h in lectures],
            "recitations": [entry(n, h) for n, h in recitations],
        }

    def test_skipped_when_no_summaries(self, monkeypatch):
        monkeypatch.setattr(db_client, "put_overview_file",
                            lambda *a: (_ for _ in ()).throw(AssertionError("must not write")))
        monkeypatch.setattr(db_client, "patch_overview_meta",
                            lambda *a: (_ for _ in ()).throw(AssertionError("must not patch meta")))
        node = self._node(lectures=[("Lecture 1", False)])
        assert run_collect(self.COURSE, node) == {"status": "skipped", "message": "no summaries found"}

    def test_done_writes_topics_md(self, monkeypatch):
        puts = {}
        patches = []
        monkeypatch.setattr(db_client, "get_summary",
                            lambda c, l, k: "# ‏כותרת\n\n## ‏נושא\n")
        monkeypatch.setattr(db_client, "put_overview_file",
                            lambda c, f, d: puts.__setitem__(f, d.decode("utf-8")))
        monkeypatch.setattr(db_client, "patch_overview_meta",
                            lambda c, s, e: patches.append((c, s, e)))
        node = self._node(lectures=[("Lecture 1", True)], recitations=[("Recitation 2", True)])
        assert run_collect(self.COURSE, node) == {"status": "done"}
        assert "topics.md" in puts
        # Meta patched for the topics slug from the collected lecture/recitation names.
        assert len(patches) == 1
        course, slug, entry = patches[0]
        assert (course, slug) == (self.COURSE, "topics")
        assert entry["lectures"] == {"start": "1", "end": "1"}
        assert entry["recitations"] == {"start": "2", "end": "2"}
        assert "generated_at" in entry
        # Entry heading is the Hebrew display label, not the English folder name.
        assert f"# {RLM}הרצאה 1" in puts["topics.md"]
        assert "# Lecture 1" not in puts["topics.md"]
        assert f"## {RLM}כותרת" in puts["topics.md"]

    def test_only_summarized_entries_fetched(self, monkeypatch):
        gets = []
        monkeypatch.setattr(db_client, "get_summary",
                            lambda c, l, k: gets.append((l, k)) or "# T\n\n## X\n")
        monkeypatch.setattr(db_client, "put_overview_file", lambda *a: None)
        monkeypatch.setattr(db_client, "patch_overview_meta", lambda *a: None)
        node = self._node(
            lectures=[("Lecture 1", True), ("Lecture 2", False)],
            recitations=[("Recitation 1", True)])
        run_collect(self.COURSE, node)
        assert gets == [("Lecture 1", "lecture"), ("Recitation 1", "recitation")]
