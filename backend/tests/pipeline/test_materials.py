import zipfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import summarize as summarize_mod
from extract_text import extract_text
from material_types import (
    MAX_GEMINI_FILE_BYTES,
    attached_materials,
    gemini_mime,
    needs_extraction,
)
from pipeline import runner
from services.errors import CodedError

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'


def _zip(path, parts: dict[str, str]):
    with zipfile.ZipFile(path, "w") as zf:
        for name, xml in parts.items():
            zf.writestr(name, xml)
    return path


# ---- support table and selection ----


def test_mime_table():
    assert gemini_mime("material.pdf") == "application/pdf"
    assert gemini_mime("a.JPG") == "image/jpeg"
    assert gemini_mime("a.md") == "text/plain"
    assert gemini_mime("a.pptx") == "text/plain"
    assert gemini_mime("a.zip") is None
    assert gemini_mime("noext") is None
    assert needs_extraction("a.DOCX") and not needs_extraction("a.pdf")


def test_attached_materials_rules():
    entries = [
        {"name": "material.pdf"},
        {"name": "material.2.pptx", "attach": False},
        {"name": "material.3.zip", "attach": True},
        {"name": "material.4.png", "attach": True},
    ]
    assert [e["name"] for e in attached_materials(entries)] == [
        "material.pdf",
        "material.4.png",
    ]


def test_materials_only_ignores_unsupported_and_switched_off():
    files = {}
    assert not runner.is_materials_only(files, [{"name": "material.zip"}])
    assert not runner.is_materials_only(files, [{"name": "m.pdf", "attach": False}])
    assert runner.is_materials_only(files, [{"name": "m.pdf"}])


# ---- extraction ----


def test_extract_docx(tmp_path):
    p = _zip(
        tmp_path / "d.docx",
        {
            "word/document.xml": f"<w:document {W}><w:body>"
            "<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>"
            "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
            "</w:body></w:document>"
        },
    )
    assert extract_text(p, "docx") == "Hello world\ncell"


def test_extract_pptx_numeric_order_with_notes(tmp_path):
    def slide(t):
        return f"<p:sld xmlns:p='x' {A}><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:sld>"

    p = _zip(
        tmp_path / "d.pptx",
        {
            "ppt/slides/slide10.xml": slide("ten"),
            "ppt/slides/slide2.xml": slide("two"),
            "ppt/notesSlides/notesSlide2.xml": slide("note two"),
        },
    )
    assert extract_text(p, "pptx") == "Slide 2\ntwo\nnote two\nSlide 10\nten"


def test_extract_xlsx(tmp_path):
    p = _zip(
        tmp_path / "d.xlsx",
        {
            "xl/sharedStrings.xml": f"<sst {S}><si><t>name</t></si><si><t>age</t></si></sst>",
            "xl/worksheets/sheet1.xml": f"<worksheet {S}><sheetData>"
            '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>'
            '<row><c t="inlineStr"><is><t>bob</t></is></c><c><v>7</v></c></row>'
            "</sheetData></worksheet>",
        },
    )
    assert extract_text(p, "xlsx") == "Sheet 1\nname\tage\nbob\t7"


def test_extract_empty_and_corrupt(tmp_path):
    p = _zip(
        tmp_path / "e.pptx",
        {"ppt/slides/slide1.xml": f"<p:sld xmlns:p='x' {A}></p:sld>"},
    )
    assert extract_text(p, "pptx") == ""
    bad = tmp_path / "bad.docx"
    bad.write_bytes(b"not a zip")
    with pytest.raises(zipfile.BadZipFile):
        extract_text(bad, "docx")


# ---- summarize sends the right mime ----


def test_summarize_sends_mime_per_file(tmp_path):
    t = tmp_path / "transcript.txt"
    t.write_text("x")
    files = [tmp_path / "material.png", tmp_path / "material.2.pptx.txt"]
    client = MagicMock()
    client.upload_file.side_effect = lambda p, m: SimpleNamespace(name=f"f/{p.name}")
    with patch.object(summarize_mod, "LLMClient", return_value=client):
        summarize_mod.summarize(t, files)
    mimes = [c.args[1] for c in client.upload_file.call_args_list]
    assert mimes == ["text/plain", "image/png", "text/plain"]


# ---- runner: size check and record ----


def _exec(listing, blobs, *, summary="# s", transcript=True):
    uploads = MagicMock()
    with (
        patch.object(
            runner.db_client,
            "file_exists",
            side_effect=lambda c, l, k, n: transcript and n == "transcript.txt",
        ),
        patch.object(runner.db_client, "list_materials", return_value=listing),
        patch.object(
            runner.db_client,
            "get_file_bytes",
            side_effect=lambda c, l, k, n: blobs.get(n, b"transcript"),
        ),
        patch.object(runner, "summarize", side_effect=lambda t, m: summary) as s,
        patch.object(runner, "summarize_materials", return_value="# s"),
        patch.object(runner.db_client, "put_summary") as put,
    ):
        result = runner._exec_summarize("C", "L", "lecture")
    return result, s, put, uploads


BIG = MAX_GEMINI_FILE_BYTES + 1


def test_oversized_attached_file_fails_before_download():
    listing = [
        {"name": "material.pdf", "size": BIG, "filename": "Big.pdf"},
        {"name": "material.2.pdf", "size": 10},
    ]
    result, s, put, _ = _exec(listing, {})
    assert result["code"] == "material_too_large"
    assert result["params"]["files"] == "Big.pdf"
    assert result["params"]["limit_mb"] == 10
    s.assert_not_called()
    put.assert_not_called()


def test_oversized_unattached_file_is_fine():
    listing = [{"name": "material.pdf", "size": BIG, "attach": False}]
    result, s, _, _ = _exec(listing, {})
    assert result["status"] == "done"


def test_records_attached_names_including_skipped_empty(put_materials):
    listing = [
        {"name": "material.pdf", "size": 3},
        {"name": "material.2.pdf", "size": 0},
        {"name": "material.3.zip", "size": 3},
    ]
    result, *_ = _exec(listing, {"material.pdf": b"abc", "material.2.pdf": b""})
    assert result == {"status": "done", "usedMaterial": True}
    put_materials.assert_called_once_with(
        "C", "L", "lecture", ["material.pdf", "material.2.pdf"]
    )


def test_transcript_only_records_empty_list(put_materials):
    _exec([], {})
    put_materials.assert_called_once_with("C", "L", "lecture", [])


def test_failed_record_keeps_run_successful(put_materials):
    put_materials.side_effect = RuntimeError("down")
    result, *_ = _exec([], {})
    assert result["status"] == "done"


def test_no_record_on_failure(put_materials):
    result, *_ = _exec([], {}, summary="")
    assert result["status"] == "error"
    put_materials.assert_not_called()


def test_corrupt_office_file_skipped_and_all_empty_is_materials_empty():
    listing = [{"name": "material.docx", "size": 8}]
    result, *_ = _exec(listing, {"material.docx": b"notazip!"}, transcript=False)
    assert result["code"] == "materials_empty"


def test_check_sizes_reports_largest():
    with pytest.raises(CodedError) as ei:
        runner._check_sizes(
            [
                {"name": "a.pdf", "size": 12 * 1024 * 1024},
                {"name": "b.pdf", "size": 11 * 1024 * 1024},
            ]
        )
    assert ei.value.params == {"files": "a.pdf, b.pdf", "limit_mb": 10, "size_mb": 12.0}
