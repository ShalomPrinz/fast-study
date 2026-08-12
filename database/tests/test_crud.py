"""Lecture-dir file deletion: the render markers that may never outlive their PDF."""

import pytest
from fs import crud
from fs.paths import PDF_BUILD_TEX_MARKER, PDF_WARNING_MARKER


@pytest.fixture
def lecture(data_root):
    d = data_root / "Algo" / "L1"
    d.mkdir(parents=True)
    return d


class TestDeleteFile:
    def test_deleting_summary_pdf_drops_both_render_markers(self, lecture):
        # Both describe THIS pdf's build: the warning line, and the .tex its `l.<N>` indexes.
        (lecture / "summary.pdf").write_bytes(b"%PDF")
        (lecture / PDF_WARNING_MARKER).write_text("LaTeX error: boom")
        (lecture / PDF_BUILD_TEX_MARKER).write_text("\\documentclass{article}")

        crud.delete_file("Algo", "L1", "summary.pdf", "lecture")

        assert not (lecture / "summary.pdf").exists()
        assert not (lecture / PDF_WARNING_MARKER).exists()
        assert not (lecture / PDF_BUILD_TEX_MARKER).exists()

    def test_deleting_summary_pdf_with_no_markers_is_fine(self, lecture):
        (lecture / "summary.pdf").write_bytes(b"%PDF")

        crud.delete_file("Algo", "L1", "summary.pdf", "lecture")

        assert not (lecture / "summary.pdf").exists()

    def test_deleting_another_file_leaves_the_markers(self, lecture):
        (lecture / "audio.mp3").write_bytes(b"ID3")
        (lecture / PDF_WARNING_MARKER).write_text("LaTeX error: boom")
        (lecture / PDF_BUILD_TEX_MARKER).write_text("\\documentclass{article}")

        crud.delete_file("Algo", "L1", "audio.mp3", "lecture")

        assert not (lecture / "audio.mp3").exists()
        assert (lecture / PDF_WARNING_MARKER).exists()
        assert (lecture / PDF_BUILD_TEX_MARKER).exists()
