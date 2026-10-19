from pathlib import Path

from .crud import check_not_reserved
from .material_sources import read_sources, write_sources
from .paths import (
    CourseNotFound,
    course_dir,
    lecture_dir,
    material_index,
    material_name,
)


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
    """List the material filenames in a lecture dir, ordered by index ascending (material.pdf first)."""

    return [name for _, name in _indexed_materials(d)]


def list_materials(d: Path) -> list[dict]:
    """Build the tree's materials list for a lecture dir: {name, size, mtime[, source]} per material, index order."""

    sources = read_sources(d) if d.is_dir() else {}
    entries = []
    for name in material_names(d):
        try:
            stat = (d / name).stat()
        except OSError:
            # Deleted between listing and stat — treat as absent rather than failing the tree.
            continue
        entry = {"name": name, "size": stat.st_size, "mtime": stat.st_mtime}
        if name in sources:
            entry["source"] = sources[name]
        entries.append(entry)
    return entries


def _adopt_legacy(
    d: Path, names: list[str], sources: dict[str, str], data: bytes
) -> str | None:
    """Return a source-less material byte-identical to data, so a pre-source download is not duplicated."""

    # Legacy-adoption patch for materials saved before sources existed; removal tracked in docs/MIGRATIONS.md.
    for name in names:
        if name in sources:
            continue
        p = d / name
        try:
            if p.stat().st_size == len(data) and p.read_bytes() == data:
                return name
        except OSError:
            continue
    return None


def write_material(
    course: str, lecture: str, kind: str, data: bytes, source: str | None = None
) -> str:
    """Save a material PDF under the next free index (or adopt an identical legacy one), record its source, return its name."""

    # The downloader uploads to brand-new lectures, so the create path's name check applies.
    check_not_reserved(lecture)
    # The lecture dir is made on demand, the course never: a PDF download finishing after its course
    # was renamed would otherwise recreate the old name as a ghost course.
    if not course_dir(course).is_dir():
        raise CourseNotFound(f"course not found: {course}", course=course)
    d = lecture_dir(course, lecture, kind)
    d.mkdir(parents=True, exist_ok=True)
    # No await between scan and write is what makes allocation lock-free — see docs/LAYOUT.md.
    pairs = _indexed_materials(d)
    names = [n for _, n in pairs]
    sources = read_sources(d)
    if source and source not in (sources[n] for n in names if n in sources):
        adopted = _adopt_legacy(d, names, sources, data)
        if adopted is not None:
            sources[adopted] = source
            write_sources(d, sources)
            return adopted
    # Highest existing + 1, so deleted slots are never reused.
    name = material_name((pairs[-1][0] + 1) if pairs else 1)
    (d / name).write_bytes(data)
    # A stale entry left by a file removed outside the API must not mislabel the new one.
    stale = sources.pop(name, None)
    if source:
        sources[name] = source
    if source or stale is not None:
        write_sources(d, sources)
    return name
