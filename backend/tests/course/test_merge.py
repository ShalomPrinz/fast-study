"""Tests for course/merge.py — the compile-phase body merger and run_merge worker.

Pure helpers (strip_and_demote, render_entry, build_all_lectures_md) are exercised directly;
run_merge is driven with db_client mocked (no network). Unlike collect, this phase keeps the
FULL section bodies — only the summarize.md built-ins are dropped."""

from course.merge import (
    build_all_lectures_md,
    render_entry,
    run_merge,
    strip_and_demote,
)
from services import db_client


class TestBuiltinRemoval:
    def test_builtin_section_body_dropped(self):
        # Regression: collect drops built-in HEADINGS; here the whole body must go too.
        md = "## תקציר\n\nמשפט תקציר\n\n## נושא\n\nגוף הנושא\n"
        out = strip_and_demote(md)
        assert "משפט תקציר" not in out
        assert "גוף הנושא" in out

    def test_all_four_builtins_dropped(self):
        md = (
            "## תקציר\n\nא\n\n"
            "## הערות אישיות והדגשות המרצה\n\nב\n\n"
            "## סיכום\n\nג\n\n"
            "## משימות נדרשות\n\nד\n"
        )
        assert strip_and_demote(md) == ""

    def test_nested_h3_inside_builtin_dropped(self):
        md = "## סיכום\n\n### תת של סיכום\n\nטקסט\n\n## נושא\n\nגוף\n"
        out = strip_and_demote(md)
        assert "תת של סיכום" not in out
        assert "טקסט" not in out
        assert "גוף" in out

    def test_h1_ends_a_builtin_section(self):
        # A new H1 closes the built-in even without an intervening H2.
        md = "## סיכום\n\nדרופ\n\n# כותרת חדשה\n\nשמור\n"
        out = strip_and_demote(md)
        assert "דרופ" not in out
        assert "שמור" in out


class TestDemotion:
    def test_every_heading_pushed_one_level(self):
        md = "# כותרת\n\n## נושא\n\n### תת\n"
        assert strip_and_demote(md).split("\n") == [
            "## כותרת",
            "",
            "### נושא",
            "",
            "#### תת",
        ]

    def test_h6_saturates_instead_of_seven_hashes(self):
        assert strip_and_demote("###### Deep\n").startswith("###### Deep")

    def test_ascii_heading_demoted(self):
        assert strip_and_demote("## Race Conditions\n") == "### Race Conditions"

    def test_body_prose_untouched(self):
        md = "## נושא\n\nפסקה עם $x^2$ ועם `malloc`\n"
        assert "פסקה עם $x^2$ ועם `malloc`" in strip_and_demote(md)


class TestRules:
    def test_all_horizontal_rules_dropped(self):
        md = "## תקציר\n\nא\n\n---\n\n## נושא\n\nגוף\n\n---\n\n## סיכום\n\nב\n"
        assert "---" not in strip_and_demote(md)

    def test_star_and_underscore_rules_dropped(self):
        assert strip_and_demote("## נושא\n\n***\n\n___\n\nגוף\n") == ("### נושא\n\nגוף")


class TestCodeFences:
    def test_heading_inside_fence_not_demoted(self):
        md = "## נושא\n\n```c\n## not a heading\nint x;\n```\n"
        out = strip_and_demote(md)
        assert "## not a heading" in out  # verbatim, not demoted to ###
        assert "int x;" in out

    def test_fence_inside_builtin_dropped(self):
        md = "## סיכום\n\n```c\nint secret;\n```\n\n## נושא\n\nגוף\n"
        out = strip_and_demote(md)
        assert "int secret" not in out
        assert "```" not in out

    def test_rule_inside_fence_kept(self):
        # `---` is meaningful inside a code block (YAML, a comment banner) — never stripped.
        assert "---" in strip_and_demote("## נושא\n\n```yaml\n---\nkey: v\n```\n")


class TestBlankCollapse:
    def test_gap_left_by_removed_section_collapsed(self):
        md = "## נושא א\n\nגוף\n\n\n\n## תקציר\n\nדרופ\n\n## נושא ב\n\nגוף ב\n"
        assert "\n\n\n" not in strip_and_demote(md)

    def test_no_leading_or_trailing_blanks(self):
        out = strip_and_demote("\n\n## נושא\n\nגוף\n\n\n")
        assert out == out.strip()


class TestRenderEntry:
    def test_lecture_h1_then_demoted_body(self):
        out = render_entry("Lecture 5.2", "# מרוצי נתונים\n\n## נושא\n\nגוף\n")
        lines = out.split("\n")
        assert lines[0] == "# הרצאה 5.2"
        assert lines[2] == "## מרוצי נתונים"
        assert "### נושא" in lines

    def test_summary_with_only_builtins_gives_header_alone(self):
        out = render_entry("Lecture 1", "## תקציר\n\nטקסט\n\n## סיכום\n\nעוד\n")
        assert out == "# הרצאה 1"


class TestBuildAllLecturesMd:
    A = ("Lecture 10.1", "# A\n\n## TA\n\nbody a\n")
    B = ("Lecture 2.2", "# B\n\n## TB\n\nbody b\n")

    def test_natural_sorted_by_english_name(self):
        md = build_all_lectures_md([self.A, self.B])
        assert md.index("הרצאה 2.2") < md.index("הרצאה 10.1")

    def test_rule_between_lectures(self):
        md = build_all_lectures_md([self.A, self.B])
        assert "\n\n---\n\n" in md
        assert md.count("\n---\n") == 1  # exactly one separator for two lectures

    def test_single_lecture_has_no_rule(self):
        assert "---" not in build_all_lectures_md([self.A])


class TestRunMerge:
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
        monkeypatch.setattr(
            db_client,
            "put_overview_file",
            lambda *a: (_ for _ in ()).throw(AssertionError("must not write")),
        )
        node = self._node(lectures=[("Lecture 1", False)])
        assert run_merge(self.COURSE, node) == {
            "status": "skipped",
            "message": "no summaries found",
        }

    def test_recitations_never_included(self, monkeypatch):
        # Lectures-only by design: a course with recitations but no lecture summaries skips.
        monkeypatch.setattr(
            db_client,
            "put_overview_file",
            lambda *a: (_ for _ in ()).throw(AssertionError("must not write")),
        )
        node = self._node(recitations=[("Recitation 1", True)])
        assert run_merge(self.COURSE, node)["status"] == "skipped"

    def test_done_writes_all_lectures_md(self, monkeypatch):
        puts = {}
        patches = []
        monkeypatch.setattr(
            db_client, "get_summary", lambda c, l, k: "# כותרת\n\n## נושא\n\nגוף\n"
        )
        monkeypatch.setattr(
            db_client,
            "put_overview_file",
            lambda c, f, d: puts.__setitem__(f, d.decode("utf-8")),
        )
        monkeypatch.setattr(
            db_client, "patch_overview_meta", lambda c, s, e: patches.append((c, s, e))
        )
        node = self._node(lectures=[("Lecture 1", True), ("Lecture 2", False)])

        assert run_merge(self.COURSE, node) == {"status": "done"}
        assert list(puts) == ["all-lectures.md"]
        assert "# הרצאה 1" in puts["all-lectures.md"]
        assert "גוף" in puts["all-lectures.md"]

        course, slug, entry = patches[0]
        assert (course, slug) == (self.COURSE, "all-lectures")
        assert entry["lectures"] == {"start": "1", "end": "1"}
        assert entry["recitations"] is None

    def test_only_lecture_summaries_fetched(self, monkeypatch):
        kinds = []
        monkeypatch.setattr(
            db_client,
            "get_summary",
            lambda c, l, k: (kinds.append(k), "# T\n\n## נושא\n\nגוף\n")[1],
        )
        monkeypatch.setattr(db_client, "put_overview_file", lambda *a: None)
        monkeypatch.setattr(db_client, "patch_overview_meta", lambda *a: None)
        node = self._node(
            lectures=[("Lecture 1", True)], recitations=[("Recitation 1", True)]
        )
        run_merge(self.COURSE, node)
        assert kinds == ["lecture"]


class TestCallouts:
    """`::: definition` blocks pass through so the merged PDF renders the same boxes —
    but a div one lecture left open must never swallow the next one."""

    def test_callout_passes_through_verbatim(self):
        md = "## נושא\n\n::: definition\nהגדרה\n:::\n"
        out = strip_and_demote(md)
        assert "::: definition" in out
        assert out.rstrip().endswith(":::")

    def test_marker_not_mistaken_for_a_rule(self):
        # RULE_RE drops every in-summary ---; ::: must not be caught by it.
        out = strip_and_demote("## נושא\n\n::: warning\nאזהרה\n:::\n")
        assert "אזהרה" in out

    def test_unclosed_div_is_closed_at_the_lecture_boundary(self):
        out = strip_and_demote("## נושא\n\n::: insight\nתובנה בלי סוגר\n")
        assert out.count(":::") == 2

    def test_stray_closer_dropped(self):
        # An orphan ::: would close a div opened by a LATER lecture in the merged file.
        out = strip_and_demote("## נושא\n\nטקסט\n\n:::\n")
        assert ":::" not in out

    def test_closer_eaten_by_a_builtin_section_still_balances(self):
        md = "## נושא\n\n::: definition\nהגדרה\n\n## סיכום\n\nסיכום\n"
        out = strip_and_demote(md)
        assert out.count(":::") == 2
        assert "סיכום" not in out

    def test_marker_inside_code_fence_is_not_counted(self):
        md = "## נושא\n\n```\n::: definition\n```\n"
        out = strip_and_demote(md)
        assert out.count(":::") == 1  # the code line only, no injected closer

    def test_open_div_does_not_leak_across_the_merge_boundary(self):
        first = "# הרצאה\n\n::: warning\nלא נסגר\n"
        second = "# הרצאה\n\nהתוכן של ההרצאה הבאה\n"
        merged = build_all_lectures_md([("Lecture 1", first), ("Lecture 2", second)])
        before_rule = merged.split("\n---\n")[0]
        assert before_rule.count(":::") == 2

    def test_nested_divs_each_get_closed(self):
        md = "## נושא\n\n::: definition\nא\n\n::: insight\nב\n"
        out = strip_and_demote(md)
        assert out.count(":::") == 4
