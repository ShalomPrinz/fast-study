from pathlib import Path

from .crud import check_not_reserved
from .material_meta import read_meta, write_meta
from .paths import (
    MATERIAL_EXT_RE,
    CourseNotFound,
    course_dir,
    lecture_dir,
    material_index,
    material_name,
)

MAX_FILENAME_LEN = 255


def _indexed_materials(d: Path) -> list[tuple[int, str]]:
    """Scan a lecture dir for material files, as (index, name) pairs sorted by index ascending."""

    if not d.is_dir():
        return []
    pairs = []
    for p in d.iterdir():
        if not p.is_file():
            continue
        index = material_index(p.name)
        if index is not None:
            pairs.append((index, p.name))
    return sorted(pairs)


def material_names(d: Path) -> list[str]:
    """List the material filenames in a lecture dir, ordered by (index, name) (material.<ext> first)."""

    return [name for _, name in _indexed_materials(d)]


def list_materials(d: Path) -> list[dict]:
    """Build the tree's materials list for a lecture dir: {name, size, mtime[, source][, filename][, attach]} per material, index order."""

    meta = read_meta(d) if d.is_dir() else {}
    entries = []
    for name in material_names(d):
        try:
            stat = (d / name).stat()
        except OSError:
            # Deleted between listing and stat — treat as absent rather than failing the tree.
            continue
        entry = {"name": name, "size": stat.st_size, "mtime": stat.st_mtime}
        entry.update(meta.get(name, {}))
        entries.append(entry)
    return entries


def _adopt_legacy(
    d: Path, names: list[str], meta: dict[str, dict], data: bytes
) -> str | None:
    """Return a source-less material byte-identical to data, so a pre-source download is not duplicated."""

    # Legacy-adoption patch for materials saved before sources existed; removal tracked in docs/MIGRATIONS.md.
    for name in names:
        if "source" in meta.get(name, {}):
            continue
        p = d / name
        try:
            if p.stat().st_size == len(data) and p.read_bytes() == data:
                return name
        except OSError:
            continue
    return None


def _clean_filename(filename: str | None) -> str | None:
    """Trim the display filename; None when nothing is left."""

    return (filename or "").strip() or None


def _disk_ext(filename: str | None) -> str:
    """Return the dotted lower-case disk ext of a display filename, or .pdf when it has no valid one."""

    ext = filename.rsplit(".", 1)[1].lower() if filename and "." in filename else ""
    return f".{ext}" if MATERIAL_EXT_RE.fullmatch(ext) else ".pdf"


def write_material(
    course: str,
    lecture: str,
    kind: str,
    data: bytes,
    source: str | None = None,
    filename: str | None = None,
) -> str:
    """Save a material under the next free index (or adopt an identical legacy one), record its meta, return its name."""

    # The downloader uploads to brand-new lectures, so the create path's name check applies.
    check_not_reserved(lecture)
    # The lecture dir is made on demand, the course never: a download finishing after its course
    # was renamed would otherwise recreate the old name as a ghost course.
    if not course_dir(course).is_dir():
        raise CourseNotFound(f"course not found: {course}", course=course)
    d = lecture_dir(course, lecture, kind)
    d.mkdir(parents=True, exist_ok=True)
    filename = _clean_filename(filename)
    # The ext comes from the full name; only the stored copy is capped.
    ext = _disk_ext(filename)
    filename = filename[:MAX_FILENAME_LEN] if filename else None
    # No await between scan and write is what makes allocation lock-free — see docs/LAYOUT.md.
    pairs = _indexed_materials(d)
    names = [n for _, n in pairs]
    meta = read_meta(d)
    if source and source not in (meta[n].get("source") for n in names if n in meta):
        adopted = _adopt_legacy(d, names, meta, data)
        if adopted is not None:
            entry = meta.setdefault(adopted, {})
            entry["source"] = source
            if filename and "filename" not in entry:
                entry["filename"] = filename
            write_meta(d, meta)
            return adopted
    # Highest index across all extensions + 1, so deleted slots are never reused.
    name = material_name(max((i for i, _ in pairs), default=0) + 1, ext)
    (d / name).write_bytes(data)
    # A stale entry left by a file removed outside the API must not mislabel the new one.
    stale = meta.pop(name, None)
    entry = {k: v for k, v in (("source", source), ("filename", filename)) if v}
    if entry:
        meta[name] = entry
    if entry or stale is not None:
        write_meta(d, meta)
    return name


def set_attach(course: str, lecture: str, kind: str, name: str, attach: bool) -> bool:
    """Record the attach flag on an existing material; False when the name isn't a material or isn't on disk; OSError if the sidecar can't be written."""

    d = lecture_dir(course, lecture, kind)
    if material_index(name) is None or not (d / name).is_file():
        return False
    meta = read_meta(d)
    meta.setdefault(name, {})["attach"] = attach
    # Strict: the flag is the whole request, so a lost write must fail it rather than answer 204.
    write_meta(d, meta, strict=True)
    return True
