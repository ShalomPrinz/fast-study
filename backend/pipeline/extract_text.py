"""Plain-text extraction from docx, pptx and xlsx files — stdlib only, one line per paragraph or row."""

import re
import zipfile
from xml.etree import ElementTree as ET

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _root(zf: zipfile.ZipFile, name: str) -> ET.Element:
    return ET.fromstring(zf.read(name))


def _numbered(zf: zipfile.ZipFile, prefix: str) -> list[tuple[int, str]]:
    """The archive's `<prefix>N.xml` parts as (N, name), in numeric order."""

    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)\.xml$")
    found = [(int(m[1]), n) for n in zf.namelist() if (m := pattern.match(n))]
    return sorted(found)


def _paragraphs(root: ET.Element, para: str, run: str) -> list[str]:
    lines = []
    for p in root.iter(para):
        text = "".join(t.text or "" for t in p.iter(run))
        if text.strip():
            lines.append(text)
    return lines


def _docx(zf: zipfile.ZipFile) -> list[str]:
    return _paragraphs(_root(zf, "word/document.xml"), f"{_W}p", f"{_W}t")


def _pptx(zf: zipfile.ZipFile) -> list[str]:
    notes = dict(_numbered(zf, "ppt/notesSlides/notesSlide"))
    lines: list[str] = []
    for n, name in _numbered(zf, "ppt/slides/slide"):
        lines.append(f"Slide {n}")
        lines += _paragraphs(_root(zf, name), f"{_A}p", f"{_A}t")
        if n in notes:
            lines += _paragraphs(_root(zf, notes[n]), f"{_A}p", f"{_A}t")
    return lines


def _xlsx(zf: zipfile.ZipFile) -> list[str]:
    shared: list[str] = []
    if "xl/sharedStrings.xml" in zf.namelist():
        for si in _root(zf, "xl/sharedStrings.xml").iter(f"{_S}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{_S}t")))
    lines: list[str] = []
    for n, name in _numbered(zf, "xl/worksheets/sheet"):
        lines.append(f"Sheet {n}")
        for row in _root(zf, name).iter(f"{_S}row"):
            cells = []
            for c in row.iter(f"{_S}c"):
                kind = c.get("t")
                if kind == "inlineStr":
                    text = "".join(t.text or "" for t in c.iter(f"{_S}t"))
                else:
                    v = c.find(f"{_S}v")
                    text = v.text or "" if v is not None else ""
                    if kind == "s" and text.isdigit() and int(text) < len(shared):
                        text = shared[int(text)]
                cells.append(text)
            if any(cells):
                lines.append("\t".join(cells))
    return lines


_READERS = {"docx": _docx, "pptx": _pptx, "xlsx": _xlsx}


def extract_text(path, ext: str) -> str:
    """The text of a docx/pptx/xlsx file, '' when it holds none; raises on a corrupt archive."""

    with zipfile.ZipFile(path) as zf:
        lines = _READERS[ext](zf)
    # A deck or workbook with only its "Slide N"/"Sheet N" headers has no content.
    if not any(not re.fullmatch(r"(Slide|Sheet) \d+", ln) for ln in lines):
        return ""
    return "\n".join(lines)
