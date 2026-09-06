"""course/to_pdf.py — the overview md→PDF phase worker and its recovered-render warning marker."""

from pathlib import Path

import pytest
from course import to_pdf as course_to_pdf
from services import db_client

COURSE = "Algo"
SLUG = "exam-hints"
MARKER = f".{SLUG}.pdf_warning"


class FakeDb:
    """Records overview writes in call order, so ordering assertions are possible."""

    def __init__(self):
        self.calls = []
        self.stored = {}

    def put(self, course, filename, data):
        self.calls.append(("put", filename))
        self.stored[filename] = data


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(db_client, "get_overview_file", lambda c, f: b"# md")
    monkeypatch.setattr(db_client, "put_overview_file", fake.put)
    return fake


def _convert(warning, pdf_bytes=b"%PDF-1.4 stub"):
    def fake_convert(md_path):
        out = Path(md_path).with_suffix(".pdf")
        out.write_bytes(pdf_bytes)
        return str(out), warning

    return fake_convert


class TestWarningMarker:
    def test_recovered_render_persists_marker_after_pdf(self, monkeypatch, db):
        monkeypatch.setattr(
            course_to_pdf, "convert_to_pdf", _convert("LaTeX: ! Undefined")
        )
        assert course_to_pdf.run_to_pdf(COURSE, SLUG) == {"status": "done"}
        # Order matters: a warning must never exist without the PDF it describes.
        assert db.calls == [("put", f"{SLUG}.pdf"), ("put", MARKER)]
        assert db.stored[MARKER] == "LaTeX: ! Undefined".encode("utf-8")

    def test_clean_render_clears_marker(self, monkeypatch, db):
        # Cleared by an EMPTY write, not a delete — the database has no overview delete route.
        db.stored[MARKER] = b"stale"
        monkeypatch.setattr(course_to_pdf, "convert_to_pdf", _convert(None))
        assert course_to_pdf.run_to_pdf(COURSE, SLUG) == {"status": "done"}
        assert db.calls == [("put", f"{SLUG}.pdf"), ("put", MARKER)]
        assert db.stored[MARKER] == b""

    def test_hard_failure_raises_and_writes_nothing(self, monkeypatch, db):
        def boom(md_path):
            raise RuntimeError("tectonic produced no PDF")

        monkeypatch.setattr(course_to_pdf, "convert_to_pdf", boom)
        with pytest.raises(RuntimeError, match="no PDF"):
            course_to_pdf.run_to_pdf(COURSE, SLUG)
        assert db.calls == []

    def test_missing_md_skips_without_touching_marker(self, monkeypatch, db):
        def missing(course, filename):
            raise db_client.DbClientError("nope")

        monkeypatch.setattr(db_client, "get_overview_file", missing)
        assert course_to_pdf.run_to_pdf(COURSE, SLUG) == {
            "status": "skipped",
            "message": "no analyzed markdown — run analyze first",
        }
        assert db.calls == []
