"""The slides' graphs in a summary: Gemini links a PDF page or a PPTX picture from summary.md, a second
call boxes each PDF graph, and each is snapped to its ink, cropped and renamed. See docs/PIPELINE.md."""

import io
import json
import logging
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

import pypdfium2 as pdfium
from google.genai import types
from PIL import Image
from services.llm_client import LLMClient
from services.resources import resource_path

from pipeline.material_types import MAX_GEMINI_FILE_BYTES

log = logging.getLogger("figures")

# A caption may hold one level of balanced brackets (`![a [b] c](…)`).
IMAGE_CAPTION = r"(?:[^\[\]\n]|\[[^\[\]\n]*\])*"

FIGURES_PROMPT_FILE = resource_path("assets", "instructions", "summarize_figures.md")
BOXES_PROMPT_FILE = resource_path("assets", "instructions", "figure_boxes.md")

MAX_FIGURES = 8
RENDER_DPI = 150
INK_BELOW = 250  # gray under this is ink
GAP_LINES = 12  # a white gap this long ends an edge's growth
MAX_GROW = 0.06  # of the page dimension, per edge
MARGIN_PX = 11
MIN_BOX = 10  # of 1000: a thinner box is degenerate
_MIMES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
}
PPTX_EXTS = tuple(_MIMES)
PPTX_MIN_SIDE = 200
PPTX_MIN_BYTES = 10 * 1024

# Strict JSON for the box call: one entry per figure id, box_2d as [ymin, xmin, ymax, xmax] in 0-1000.
BOX_SCHEMA = {
    "type": "object",
    "properties": {
        "figures": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "found": {"type": "boolean"},
                    "box_2d": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "minItems": 4,
                        "maxItems": 4,
                    },
                },
                "required": ["id", "found", "box_2d"],
            },
        }
    },
    "required": ["figures"],
}

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_IMAGE_LINE_RE = re.compile(
    rf"^[ \t]*!\[(?P<caption>{IMAGE_CAPTION})\]\((?P<target>[^)\n]*)\)[ \t]*$",
    re.MULTILINE,
)
_PAGE_RE = re.compile(r"^page=(\d+)$")


@dataclass
class Picture:
    """One PPTX-embedded picture offered to Gemini: `ref` is the link target it must copy."""

    ref: str
    path: Path  # the file sent to Gemini
    slide: int
    mime: str
    original: bytes  # the picture as the deck holds it, which is what the figure is


@dataclass
class FigureSources:
    """What a summary may link: PDF materials by allocated name, PPTX pictures by ref, and the
    label text naming each file sent. `files` is filled by the summarize call with `figN.ext` bytes."""

    pdfs: dict[str, Path] = field(default_factory=dict)
    pictures: dict[str, Picture] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    files: dict[str, bytes] = field(default_factory=dict)

    def has_sources(self) -> bool:
        return bool(self.pdfs or self.pictures)

    def add_materials(
        self, sent: list[tuple[str, Path]], displays: dict[str, str], dest: Path
    ) -> None:
        """Register each file sent as (allocated name, file sent): its label, and the PDF or the
        PPTX's pictures. `dest` holds the original of an Office file, which is sent as text."""

        for name, path in sent:
            shown = displays.get(name, name)
            self.labels[path.name] = (
                f"FILE {name} (original file name: {shown})"
                if shown != name
                else f"FILE {name}"
            )
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if ext == "pdf":
                self.pdfs[name] = path
            elif ext == "pptx":
                for pic in extract_pptx_pictures(dest / name, name, dest):
                    self.pictures[pic.ref] = pic


def figures_prompt() -> str:
    return FIGURES_PROMPT_FILE.read_text(encoding="utf-8")


# ---- PPTX pictures ----


def _slide_pictures(zf: zipfile.ZipFile) -> dict[str, int]:
    """Each media part a slide references (not a layout or master) → the first slide using it."""

    found: dict[str, int] = {}
    pattern = re.compile(r"^ppt/slides/_rels/slide(\d+)\.xml\.rels$")
    slides = sorted((int(m[1]), n) for n in zf.namelist() if (m := pattern.match(n)))
    for number, rels in slides:
        for rel in ET.fromstring(zf.read(rels)).iter(f"{_REL}Relationship"):
            if not str(rel.get("Type", "")).endswith("/image"):
                continue
            target = PurePosixPath("ppt/slides") / str(rel.get("Target", ""))
            parts: list[str] = []
            for part in target.parts:  # resolves the `..` of a `../media/x.png` target
                if part == "..":
                    if parts:
                        parts.pop()
                else:
                    parts.append(part)
            found.setdefault("/".join(parts), number)
    return found


def _picture_ok(data: bytes, name: str) -> Image.Image | None:
    """The picture as an image when it passes the size filters, else None (logged)."""

    if len(data) < PPTX_MIN_BYTES:
        log.info("figures: skipping %s: %d bytes is under the minimum", name, len(data))
        return None
    if len(data) > MAX_GEMINI_FILE_BYTES:
        log.warning("figures: skipping %s: over the per-file cap", name)
        return None
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:
        log.warning("figures: skipping unreadable picture %s: %s", name, e)
        return None
    if min(img.size) < PPTX_MIN_SIDE:
        log.info("figures: skipping %s: %dx%d is too small", name, *img.size)
        return None
    return img


def extract_pptx_pictures(pptx: Path, name: str, dest: Path) -> list[Picture]:
    """The embedded raster pictures slides of `pptx` show, written into `dest` as sendable files.
    EMF/WMF, tiny logos and over-cap pictures are skipped; a GIF is sent as PNG, which Gemini reads."""

    pictures: list[Picture] = []
    try:
        with zipfile.ZipFile(pptx) as zf:
            for part, slide in _slide_pictures(zf).items():
                media = part.rsplit("/", 1)[-1]
                ext = media.rsplit(".", 1)[-1].lower() if "." in media else ""
                if ext not in PPTX_EXTS or part not in zf.namelist():
                    continue
                data = zf.read(part)
                img = _picture_ok(data, f"{name}#{media}")
                if img is None:
                    continue
                path, sent, mime = dest / f"{name}#{media}", data, _MIMES[ext]
                if ext == "gif":
                    # The one allowed raster Gemini does not read: sent as PNG, linked by its own name.
                    buf = io.BytesIO()
                    img.convert("RGBA").save(buf, "PNG")
                    sent, mime = buf.getvalue(), "image/png"
                    if len(sent) > MAX_GEMINI_FILE_BYTES:
                        continue
                path.write_bytes(sent)
                pictures.append(Picture(f"{name}#{media}", path, slide, mime, data))
    except (zipfile.BadZipFile, ET.ParseError, KeyError) as e:
        log.warning("figures: cannot read pictures of %s: %s", name, e)
    return pictures


def picture_label(pic: Picture) -> str:
    return f"PICTURE {pic.ref} (on slide {pic.slide})"


# ---- Links ----


@dataclass
class Link:
    """One standalone image line of the summary and where it points."""

    span: tuple[int, int]
    caption: str
    material: str | None = None
    page: int | None = None  # 1-based, for a PDF page
    picture: str | None = None  # the ref, for a PPTX picture


def parse_target(target: str) -> tuple[str, int | None, str | None] | None:
    """`name#page=N` → (name, N, None); `name#picname` → (name, None, "name#picname"); else None."""

    target = target.strip().strip("<>").strip()
    material, sep, fragment = target.partition("#")
    if not (material and sep and fragment):
        return None
    m = _PAGE_RE.match(fragment)
    if m:
        return material, int(m[1]), None
    return material, None, f"{material}#{fragment}"


def find_links(md: str) -> list[Link]:
    """Every standalone image line, in order; an unparseable target leaves `material` None."""

    links = []
    for m in _IMAGE_LINE_RE.finditer(md):
        link = Link(m.span(), m["caption"].strip())
        parsed = parse_target(m["target"])
        if parsed:
            link.material, link.page, link.picture = parsed
        links.append(link)
    return links


# ---- Box → crop ----


def box_to_pixels(box, width: int, height: int) -> tuple[int, int, int, int] | None:
    """Gemini's [ymin, xmin, ymax, xmax] on 0-1000 as a pixel (x0, y0, x1, y1), clamped to the
    page. None for anything that is not four numbers or is thinner than 1% after clamping."""

    try:
        ymin, xmin, ymax, xmax = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    ymin, ymax = (min(max(v, 0.0), 1000.0) for v in (ymin, ymax))
    xmin, xmax = (min(max(v, 0.0), 1000.0) for v in (xmin, xmax))
    if ymax - ymin < MIN_BOX or xmax - xmin < MIN_BOX:
        return None
    return (
        round(xmin * width / 1000),
        round(ymin * height / 1000),
        round(xmax * width / 1000),
        round(ymax * height / 1000),
    )


def _inked(gray: Image.Image, area: tuple[int, int, int, int]) -> bool:
    return gray.crop(area).getextrema()[0] < INK_BELOW


def _grow(has_ink, lines) -> int | None:
    """The last line holding ink before a GAP_LINES white run, scanning `lines` outward."""

    last, gap = None, 0
    for i in lines:
        if has_ink(i):
            last, gap = i, 0
        else:
            gap += 1
            if gap >= GAP_LINES:
                break
    return last


def _grow_rows(gray: Image.Image, x0: int, x1: int, rows) -> int | None:
    return _grow(lambda y: _inked(gray, (x0, y, x1, y + 1)), rows)


def _grow_cols(gray: Image.Image, y0: int, y1: int, cols) -> int | None:
    return _grow(lambda x: _inked(gray, (x, y0, x + 1, y1)), cols)


def snap_box(
    gray: Image.Image, box: tuple[int, int, int, int]
) -> tuple[int, int, int, int] | None:
    """Fit `box` to the graph's ink: each edge grows outward through ink until a white gap, at most 6%
    of the page, then blank edges are trimmed and a margin added. None when the box holds no ink."""

    w, h = gray.size
    x0, y0, x1, y1 = box
    ox0, oy0, ox1, oy1 = box
    reach_x, reach_y = int(w * MAX_GROW), int(h * MAX_GROW)
    for _ in range(3):  # an edge that grew may expose ink to its neighbours
        before = (x0, y0, x1, y1)
        top = _grow_rows(gray, x0, x1, range(y0 - 1, max(oy0 - reach_y, 0) - 1, -1))
        y0 = min(y0, top) if top is not None else y0
        bottom = _grow_rows(gray, x0, x1, range(y1, min(oy1 + reach_y, h)))
        y1 = max(y1, bottom + 1) if bottom is not None else y1
        left = _grow_cols(gray, y0, y1, range(x0 - 1, max(ox0 - reach_x, 0) - 1, -1))
        x0 = min(x0, left) if left is not None else x0
        right = _grow_cols(gray, y0, y1, range(x1, min(ox1 + reach_x, w)))
        x1 = max(x1, right + 1) if right is not None else x1
        if (x0, y0, x1, y1) == before:
            break
    if not _inked(gray, (x0, y0, x1, y1)):
        return None
    while not _inked(gray, (x0, y0, x1, y0 + 1)):
        y0 += 1
    while not _inked(gray, (x0, y1 - 1, x1, y1)):
        y1 -= 1
    while not _inked(gray, (x0, y0, x0 + 1, y1)):
        x0 += 1
    while not _inked(gray, (x1 - 1, y0, x1, y1)):
        x1 -= 1
    return (
        max(x0 - MARGIN_PX, 0),
        max(y0 - MARGIN_PX, 0),
        min(x1 + MARGIN_PX, w),
        min(y1 + MARGIN_PX, h),
    )


def _crop_pdf_page(
    pdf_path: Path,
    index: int,
    px_box: tuple[int, int, int, int],
    size_px: tuple[int, int],
) -> bytes:
    """A one-page PDF of `index` whose boxes are `px_box` (render pixels) in page points, so the
    graph stays vector. Assumes an unrotated page, which the caller checked."""

    src = pdfium.PdfDocument(str(pdf_path))
    try:
        left, bottom, right, top = src[index].get_cropbox()
        sx, sy = (right - left) / size_px[0], (top - bottom) / size_px[1]
        x0, y0, x1, y1 = px_box
        box = (left + x0 * sx, top - y1 * sy, left + x1 * sx, top - y0 * sy)
        dst = pdfium.PdfDocument.new()
        try:
            dst.import_pages(src, [index])
            page = dst[0]
            page.set_mediabox(*box)
            page.set_cropbox(*box)
            out = io.BytesIO()
            dst.save(out)
            return out.getvalue()
        finally:
            dst.close()
    finally:
        src.close()


# ---- The box call ----


def request_boxes(
    wanted: list[tuple[int, str, int, bytes]],
) -> dict[int, list | None]:
    """One Gemini call for every PDF figure, as (id, caption, page, page PNG): id → box_2d, None when
    Gemini did not find it. Raises when the call or its JSON fails."""

    contents: list = [BOXES_PROMPT_FILE.read_text(encoding="utf-8")]
    for fid, caption, page, png in wanted:
        contents.append(f"Figure {fid} (slide {page}): {caption}")
        contents.append(types.Part.from_bytes(data=png, mime_type="image/png"))
    reply = json.loads(
        LLMClient().generate(contents, response_schema=BOX_SCHEMA, temperature=0)
    )
    boxes: dict[int, list | None] = {}
    for entry in reply["figures"]:
        boxes[int(entry["id"])] = entry["box_2d"] if entry["found"] else None
    return boxes


# ---- The step ----


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _render_page(pdf_path: Path, page_no: int):
    """(page image at RENDER_DPI, 0-based index) for a 1-based page, or None when it does not
    exist or is rotated."""

    try:
        doc = pdfium.PdfDocument(str(pdf_path))
    except Exception as e:
        log.warning("figures: cannot open %s: %s", pdf_path.name, e)
        return None
    try:
        if not 1 <= page_no <= len(doc):
            log.warning("figures: %s has no page %d", pdf_path.name, page_no)
            return None
        page = doc[page_no - 1]
        if page.get_rotation():
            log.warning("figures: %s page %d is rotated", pdf_path.name, page_no)
            return None
        return page.render(scale=RENDER_DPI / 72).to_pil().convert("RGB")
    except Exception as e:
        log.warning("figures: cannot render %s page %d: %s", pdf_path.name, page_no, e)
        return None
    finally:
        doc.close()


def resolve_figures(summary: str, sources: FigureSources) -> str:
    """Turn the summary's image links into figures: fills `sources.files` with `figN.ext` bytes and
    returns the summary with each kept link rewritten to `figures/figN.ext`. A figure that cannot be
    made drops its line, never the summary."""

    links = find_links(summary)
    candidates: list[Link] = []
    for link in links:
        if link.page is not None and link.material in sources.pdfs:
            ok = True
        elif link.picture is not None and link.picture in sources.pictures:
            ok = True
        else:
            ok = False
            log.warning("figures: dropping %r: unknown source", link.caption)
        if ok and len(candidates) < MAX_FIGURES:
            candidates.append(link)
        elif ok:
            log.warning(
                "figures: dropping %r: over the %d cap", link.caption, MAX_FIGURES
            )

    made: dict[
        int, tuple[str, bytes]
    ] = {}  # id of the link in `candidates` → (ext, bytes)
    pages: dict[int, tuple[Image.Image, bytes]] = {}
    for fid, link in enumerate(candidates):
        if link.picture is not None:
            pic = sources.pictures[link.picture]
            ext = pic.ref.rsplit(".", 1)[-1].lower()
            # xdvipdfmx cannot include a GIF: the PNG sent to Gemini is what is stored.
            made[fid] = (
                ("png", pic.path.read_bytes()) if ext == "gif" else (ext, pic.original)
            )
            continue
        rendered = _render_page(sources.pdfs[link.material], link.page)
        if rendered is not None:
            pages[fid] = (rendered, _png(rendered))
    if pages:
        try:
            boxes = request_boxes(
                [
                    (fid + 1, candidates[fid].caption, candidates[fid].page, png)
                    for fid, (_, png) in pages.items()
                ]
            )
        except Exception as e:
            log.warning("figures: box call failed, dropping every PDF figure: %s", e)
            boxes = {}
        for fid, (img, _) in pages.items():
            link = candidates[fid]
            px = box_to_pixels(boxes.get(fid + 1), *img.size)
            snapped = snap_box(img.convert("L"), px) if px else None
            if snapped is None:
                log.warning("figures: dropping %r: no usable box", link.caption)
                continue
            try:
                data = _crop_pdf_page(
                    sources.pdfs[link.material], link.page - 1, snapped, img.size
                )
            except Exception as e:
                log.warning("figures: dropping %r: crop failed: %s", link.caption, e)
                continue
            made[fid] = ("pdf", data)

    out, pos, number = [], 0, 0
    names: dict[tuple[int, int], str] = {}
    for fid, link in enumerate(candidates):
        if fid in made:
            number += 1
            ext, data = made[fid]
            names[link.span] = f"fig{number}.{ext}"
            sources.files[f"fig{number}.{ext}"] = data
    for link in links:
        out.append(summary[pos : link.span[0]])
        pos = link.span[1]
        name = names.get(link.span)
        if name:
            out.append(f"![{link.caption}](figures/{name})")
        elif pos < len(summary) and summary[pos] == "\n":
            pos += 1  # the dropped line's own newline
    out.append(summary[pos:])
    return "".join(out)
