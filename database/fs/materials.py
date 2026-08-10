from pathlib import Path

from .paths import lecture_dir, material_index, material_name


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
    """Build the tree's materials list for a lecture dir: {name, size, mtime} per material, index order."""

    entries = []
    for name in material_names(d):
        try:
            stat = (d / name).stat()
        except OSError:
            # Deleted between listing and stat — treat as absent rather than failing the tree.
            continue
        entries.append({"name": name, "size": stat.st_size, "mtime": stat.st_mtime})
    return entries


def _next_index(d: Path) -> int:
    """Return the next material index: highest existing + 1, so deleted slots are never reused."""

    pairs = _indexed_materials(d)
    return (pairs[-1][0] + 1) if pairs else 1


def write_material(course: str, lecture: str, kind: str, data: bytes) -> str:
    """Save a new material PDF under the next free index and return its filename."""

    d = lecture_dir(course, lecture, kind)
    # The downloader uploads to brand-new lectures, so create the dir if missing.
    d.mkdir(parents=True, exist_ok=True)
    # Scan-then-write needs no lock only because the caller never awaits between the two. An
    # `await` here, a plain-`def` (threadpool) route, or a second uvicorn worker breaks that.
    name = material_name(_next_index(d))
    (d / name).write_bytes(data)
    return name
