import fitz
import pytest
from course.merged_pdf import join_pdfs
from pypdf import PdfReader


def _make(path, pages, toc=None):
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"{path.stem} p{i + 1}")
    if toc:
        doc.set_toc(toc)
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def parts(tmp_path):
    a = _make(tmp_path / "a.pdf", 3, [[1, "A1", 1], [2, "A1.1", 2], [1, "A2", 3]])
    b = _make(tmp_path / "b.pdf", 2)  # no outline
    c = _make(tmp_path / "c.pdf", 2, [[1, "C1", 2]])
    return [a, b, c]


def test_page_count_is_the_sum_and_each_part_starts_a_page(tmp_path, parts):
    out = join_pdfs(parts, ["LA", "LB", "LC"], "T", tmp_path / "out.pdf")
    doc = fitz.open(out)
    assert doc.page_count == 7
    assert [doc[i].get_text().strip() for i in (0, 3, 5)] == [
        "a p1",
        "b p1",
        "c p1",
    ]


def test_outline_is_two_level_with_remapped_destinations(tmp_path, parts):
    out = join_pdfs(parts, ["LA", "LB", "LC"], "T", tmp_path / "out.pdf")
    toc = fitz.open(out).get_toc()
    # (level, title, 1-based page): one top-level item per part, its own outline nested under it.
    assert toc == [
        [1, "LA", 1],
        [2, "A1", 1],
        [3, "A1.1", 2],
        [2, "A2", 3],
        [1, "LB", 4],
        [1, "LC", 6],
        [2, "C1", 7],
    ]


def test_title_metadata_and_page_mode(tmp_path, parts):
    out = join_pdfs(parts, ["LA", "LB", "LC"], "כותרת", tmp_path / "out.pdf")
    reader = PdfReader(out)
    assert reader.metadata.title == "כותרת"
    assert reader.page_mode == "/UseOutlines"


def test_a_hebrew_label_survives(tmp_path, parts):
    out = join_pdfs(parts[:1], ["הרצאה 5.2"], "T", tmp_path / "out.pdf")
    assert fitz.open(out).get_toc()[0] == [1, "הרצאה 5.2", 1]
