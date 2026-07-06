"""Overview to_pdf phase worker: read one extractor's {slug}.md and render
{slug}.pdf via the pipeline's convert_to_pdf. A missing .md just skips.
Pure work — the runner owns the loop, status, notify, and failure isolation.

Distinct from pipeline/to_pdf.py (imported below as the LaTeX renderer); this module is the
per-course phase worker, that one is the per-lecture markdown→PDF primitive it reuses."""

import tempfile
from pathlib import Path

from pipeline.to_pdf import convert_to_pdf
from services import db_client


def run_to_pdf(course: str, slug: str) -> dict:
    """Render one extractor's analyzed markdown to PDF; write {slug}.pdf. Returns a
    status dict ("skipped"/"done"); raises on render/I/O failure so the runner records "error"."""
    md_name = f"{slug}.md"
    try:
        md_bytes = db_client.get_overview_file(course, md_name)
    except db_client.DbClientError:
        return {"status": "skipped", "message": "no analyzed markdown — run analyze first"}
    # convert_to_pdf needs the .md on disk and drops the .pdf beside it (same stem),
    # so round-trip through a temp dir: db bytes → file → convert → db bytes.
    with tempfile.TemporaryDirectory() as tmp:
        md_path = Path(tmp) / md_name
        md_path.write_bytes(md_bytes)
        pdf_path = convert_to_pdf(str(md_path))
        pdf_bytes = Path(pdf_path).read_bytes()
    db_client.put_overview_file(course, f"{slug}.pdf", pdf_bytes)
    return {"status": "done"}
