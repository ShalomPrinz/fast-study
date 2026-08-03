"""Course-overview file listing: the per-slug .{slug}.pdf_warning marker convention."""

import pytest
from fs import overview
from fs.paths import overview_pdf_warning_marker


@pytest.fixture
def course(data_root):
    """Create a course with an overview dir and return its path."""

    d = data_root / "Algo" / "overview"
    d.mkdir(parents=True)
    return d


def _entry(name: str) -> dict:
    """Find one entry by name in the Algo overview listing; fails the test if it isn't listed."""

    listing = overview.list_overview_files("Algo")
    match = next((e for e in listing if e["name"] == name), None)
    assert match is not None, f"{name} not in listing: {[e['name'] for e in listing]}"
    return match


class TestOverviewPdfWarning:
    def test_warning_inlined_on_pdf_entry(self, course):
        (course / "exam-hints.pdf").write_bytes(b"%PDF-")
        (course / overview_pdf_warning_marker("exam-hints")).write_text(
            "! Undefined control sequence (l.42)\n", encoding="utf-8"
        )
        assert (
            _entry("exam-hints.pdf")["warning"] == "! Undefined control sequence (l.42)"
        )

    def test_no_key_when_marker_missing(self, course):
        (course / "exam-hints.pdf").write_bytes(b"%PDF-")
        assert "warning" not in _entry("exam-hints.pdf")

    @pytest.mark.parametrize("body", ["", "   \n\t "])
    def test_no_key_when_marker_empty_or_whitespace(self, course, body):
        (course / "exam-hints.pdf").write_bytes(b"%PDF-")
        (course / overview_pdf_warning_marker("exam-hints")).write_text(
            body, encoding="utf-8"
        )
        assert "warning" not in _entry("exam-hints.pdf")

    def test_warning_is_per_slug(self, course):
        # One marker must not leak onto another extractor's pdf.
        for slug in ("exam-hints", "topics"):
            (course / f"{slug}.pdf").write_bytes(b"%PDF-")
        (course / overview_pdf_warning_marker("topics")).write_text(
            "boom", encoding="utf-8"
        )
        assert "warning" not in _entry("exam-hints.pdf")
        assert _entry("topics.pdf")["warning"] == "boom"

    def test_marker_dotfiles_are_not_listed(self, course):
        (course / "exam-hints.pdf").write_bytes(b"%PDF-")
        (course / overview_pdf_warning_marker("exam-hints")).write_text(
            "boom", encoding="utf-8"
        )
        names = [e["name"] for e in overview.list_overview_files("Algo")]
        assert names == ["exam-hints.pdf"]

    def test_non_pdf_entries_never_get_a_warning(self, course):
        (course / "exam-hints.txt").write_text("sources", encoding="utf-8")
        (course / overview_pdf_warning_marker("exam-hints")).write_text(
            "boom", encoding="utf-8"
        )
        assert "warning" not in _entry("exam-hints.txt")


class TestOverviewMarkerWrites:
    """The backend writes and clears the marker through the plain overview-file path."""

    def test_dot_prefixed_name_is_writable(self, course):
        name = overview_pdf_warning_marker("exam-hints")
        overview.write_overview_file("Algo", name, b"boom")
        assert (course / name).read_text(encoding="utf-8") == "boom"

    def test_empty_write_clears_the_warning(self, course):
        (course / "exam-hints.pdf").write_bytes(b"%PDF-")
        name = overview_pdf_warning_marker("exam-hints")
        overview.write_overview_file("Algo", name, b"boom")
        overview.write_overview_file("Algo", name, b"")
        assert "warning" not in _entry("exam-hints.pdf")
