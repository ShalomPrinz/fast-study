import io

import fitz
import pytest
from course.merged_pdf import _prefix_named_dests, join_pdfs
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)


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


def _linked(path, mode):
    """Two pages; page 1 has a link to the named dest `Hfootnote.1`, which targets page 2."""
    w = PdfWriter()
    w.add_blank_page(200, 200)
    w.add_blank_page(200, 200)
    w.add_named_destination("Hfootnote.1", 1)
    link = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Link"),
            NameObject("/Rect"): ArrayObject(
                [NumberObject(0), NumberObject(0), NumberObject(50), NumberObject(50)]
            ),
        }
    )
    if mode == "goto":
        link[NameObject("/A")] = DictionaryObject(
            {
                NameObject("/S"): NameObject("/GoTo"),
                NameObject("/D"): TextStringObject("Hfootnote.1"),
            }
        )
    else:
        link[NameObject("/Dest")] = TextStringObject("Hfootnote.1")
    w.pages[0][NameObject("/Annots")] = ArrayObject([w._add_object(link)])
    with open(path, "wb") as f:
        w.write(f)
    return path


@pytest.mark.parametrize("mode", ["goto", "dest"])
def test_internal_links_stay_inside_their_own_part(tmp_path, mode):
    a, b = _linked(tmp_path / "a.pdf", mode), _linked(tmp_path / "b.pdf", mode)
    out = join_pdfs([a, b], ["A", "B"], "T", tmp_path / "out.pdf")
    reader = PdfReader(out)
    dests = reader.named_destinations
    landed = []
    for page_no in (0, 2):  # first page of each part
        annot = reader.pages[page_no]["/Annots"][0].get_object()
        name = annot["/Dest"] if mode == "dest" else annot["/A"]["/D"]
        landed.append(reader.get_destination_page_number(dests[str(name).lstrip("/")]))
    assert landed == [1, 3]


def _link(w, action):
    link = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Link"),
            NameObject("/Rect"): ArrayObject(
                [NumberObject(0), NumberObject(0), NumberObject(50), NumberObject(50)]
            ),
            NameObject("/A"): action,
        }
    )
    return w._add_object(link)


def _goto(name):
    return DictionaryObject(
        {
            NameObject("/S"): NameObject("/GoTo"),
            NameObject("/D"): TextStringObject(name),
        }
    )


def _hyperref_like(path):
    """Page 2 holds `section.1`; one shared /A is used by two links on two pages, the outline item
    uses a named GoTo, and an attachment sits in /Names beside the dests."""
    w = PdfWriter()
    w.add_blank_page(200, 200)
    w.add_blank_page(200, 200)
    w.add_named_destination("section.1", 1)
    shared = w._add_object(_goto("section.1"))
    w.pages[0][NameObject("/Annots")] = ArrayObject(
        [_link(w, shared), _link(w, shared)]
    )
    w.pages[1][NameObject("/Annots")] = ArrayObject([_link(w, shared)])
    item = w.add_outline_item("Sec", 0)
    w.get_object(item)[NameObject("/A")] = _goto("section.1")
    w.get_object(item).pop("/Page", None)
    w.add_attachment("note.txt", b"hello")
    with open(path, "wb") as f:
        w.write(f)
    return path


def _land(reader, dest_name):
    dests = reader.named_destinations
    return reader.get_destination_page_number(dests[str(dest_name).lstrip("/")])


def test_outline_named_dest_keeps_nesting_and_its_own_part(tmp_path):
    a, b = _hyperref_like(tmp_path / "a.pdf"), _hyperref_like(tmp_path / "b.pdf")
    out = join_pdfs([a, b], ["A", "B"], "T", tmp_path / "out.pdf")
    assert fitz.open(out).get_toc() == [
        [1, "A", 1],
        [2, "Sec", 2],
        [1, "B", 3],
        [2, "Sec", 4],
    ]


def test_shared_action_is_prefixed_once_and_links_survive(tmp_path):
    a, b = _hyperref_like(tmp_path / "a.pdf"), _hyperref_like(tmp_path / "b.pdf")
    out = join_pdfs([a, b], ["A", "B"], "T", tmp_path / "out.pdf")
    reader = PdfReader(out)
    for first, target in ((0, 1), (2, 3)):
        counts = [len(reader.pages[first + k].get("/Annots") or []) for k in (0, 1)]
        assert counts == [2, 1]
        for k in (0, 1):
            for ref in reader.pages[first + k]["/Annots"]:
                name = str(ref.get_object()["/A"]["/D"])
                assert name.count("-") == 1 and name.endswith("-section.1")
                assert _land(reader, name) == target


def test_prefixing_keeps_other_name_trees(tmp_path):
    a = _hyperref_like(tmp_path / "a.pdf")
    out = PdfReader(io.BytesIO(_prefix_named_dests(a.read_bytes(), "p0-")))
    assert list(out.attachments) == ["note.txt"]
