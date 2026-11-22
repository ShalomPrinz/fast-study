"""Pure PDF joiner for the course-level merged PDF: whole documents back to back under a two-level
outline, no filesystem knowledge beyond the paths it is handed."""

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def join_pdfs(inputs: list[Path], labels: list[str], title: str, out: Path) -> Path:
    """Join `inputs` in order into `out`, each starting a new page. Each label becomes a top-level
    bookmark at its part's first page, with that part's own outline nested under it."""

    writer = PdfWriter()
    for path, label in zip(inputs, labels, strict=True):
        # Read into memory so no handle stays open on the temp file (Windows can't delete it).
        reader = PdfReader(io.BytesIO(Path(path).read_bytes()))
        writer.append(reader, outline_item=label, import_outline=True)
    writer.add_metadata({"/Title": title})
    writer.page_mode = "/UseOutlines"
    with open(out, "wb") as f:
        writer.write(f)
    return Path(out)
