"""Overview to_pdf phase worker: render one extractor's {slug}.md to {slug}.pdf.

Distinct from pipeline/to_pdf.py — this is the per-course phase worker, that is the
per-lecture markdown→PDF primitive it reuses."""

import tempfile
from pathlib import Path

from pipeline.to_pdf import convert_to_pdf
from services import db_client


def warning_file(slug: str) -> str:
    """Marker holding a recovered render's warning for {slug}.pdf; the database inlines it."""

    return f".{slug}.pdf_warning"


def run_to_pdf(course: str, slug: str) -> dict:
    """Render one extractor's analyzed markdown to {slug}.pdf; a missing .md skips.
    Raises on render/I/O failure so the runner records it as "error"."""

    md_name = f"{slug}.md"
    try:
        md_bytes = db_client.get_overview_file(course, md_name)
    except db_client.DbClientError:
        return {
            "status": "skipped",
            "message": "no analyzed markdown — run analyze first",
        }
    # convert_to_pdf needs the .md on disk and drops the .pdf beside it, so round-trip
    # through a temp dir.
    with tempfile.TemporaryDirectory() as tmp:
        md_path = Path(tmp) / md_name
        md_path.write_bytes(md_bytes)
        pdf_path, warning = convert_to_pdf(str(md_path))
        pdf_bytes = Path(pdf_path).read_bytes()
    db_client.put_overview_file(course, f"{slug}.pdf", pdf_bytes)
    # Written only after the PDF upload, so a warning never exists without its PDF. A clean
    # render clears the marker by writing it EMPTY — the database has no overview delete
    # route, and it reads an empty marker as no warning at all.
    marker = b"" if warning is None else warning.encode("utf-8")
    db_client.put_overview_file(course, warning_file(slug), marker)
    return {"status": "done"}
