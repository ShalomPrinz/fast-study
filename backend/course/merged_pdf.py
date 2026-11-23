"""Pure PDF joiner for the course-level merged PDF: whole documents back to back under a two-level
outline, no filesystem knowledge beyond the paths it is handed."""

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, TextStringObject


def _prefix_named_dests(data: bytes, prefix: str) -> bytes:
    """Rename every named destination to `prefix + name` and retarget the part's links and outline
    to match: parts share one hyperref template, and pypdf keeps only the first of a repeated name."""

    w = PdfWriter(clone_from=PdfReader(io.BytesIO(data)))
    dests = {
        name: d.dest_array for name, d in w.named_destinations.items() if d.dest_array
    }
    # Only the dest trees go: other /Names trees (embedded files, JavaScript) are kept.
    w._root_object.pop("/Dests", None)
    names = w._root_object.get("/Names")
    if names is not None:
        names.get_object().pop("/Dests", None)
    for name, arr in dests.items():
        w.add_named_destination_array(prefix + name, ArrayObject(arr))

    # A holder (an /A dict, say) can be shared by several references; renaming it twice would stack prefixes.
    seen: set[int] = set()

    def retarget(holder: DictionaryObject, key: str) -> None:
        d = holder.get(key)
        if isinstance(d, NameObject):
            holder[NameObject(key)] = NameObject("/" + prefix + str(d)[1:])
        elif isinstance(d, str):
            holder[NameObject(key)] = TextStringObject(prefix + str(d))

    def retarget_item(item: DictionaryObject) -> None:
        if id(item) in seen:
            return
        seen.add(id(item))
        retarget(item, "/Dest")
        action = item.get("/A")
        if action is not None:
            action = action.get_object()
            if action.get("/S") == "/GoTo" and id(action) not in seen:
                seen.add(id(action))
                retarget(action, "/D")

    for page in w.pages:
        for ref in page.get("/Annots") or []:
            annot = ref.get_object()
            if annot.get("/Subtype") == "/Link":
                retarget_item(annot)

    def walk_outline(item) -> None:
        visited: set[int] = set()
        while item is not None:
            item = item.get_object()
            if id(item) in visited:
                return
            visited.add(id(item))
            retarget_item(item)
            walk_outline(item.get("/First"))
            item = item.get("/Next")

    outlines = w._root_object.get("/Outlines")
    if outlines is not None:
        walk_outline(outlines.get_object().get("/First"))
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def join_pdfs(inputs: list[Path], labels: list[str], title: str, out: Path) -> Path:
    """Join `inputs` in order into `out`, each starting a new page. Each label becomes a top-level
    bookmark at its part's first page, with that part's own outline nested under it."""

    writer = PdfWriter()
    for i, (path, label) in enumerate(zip(inputs, labels, strict=True)):
        # Read into memory so no handle stays open on the temp file (Windows can't delete it).
        data = _prefix_named_dests(Path(path).read_bytes(), f"p{i}-")
        reader = PdfReader(io.BytesIO(data))
        writer.append(reader, outline_item=label, import_outline=True)
    writer.add_metadata({"/Title": title})
    writer.page_mode = "/UseOutlines"
    with open(out, "wb") as f:
        writer.write(f)
    return Path(out)
