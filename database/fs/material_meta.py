import json
import logging
import os
from pathlib import Path

from .paths import MATERIAL_META_MARKER

log = logging.getLogger("db")

# Keys an entry may carry, each with the type it must have to be read.
_KEYS = {"source": str, "filename": str, "attach": bool}


def read_json_dict(d: Path, marker: str) -> dict:
    """Read a sidecar's JSON object; absent, corrupt, unreadable or not an object reads as {}."""

    try:
        raw = json.loads((d / marker).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


def write_json_dict(d: Path, marker: str, data: dict, strict: bool = False) -> None:
    """Persist a sidecar atomically (temp file + os.replace), removing it once empty; best-effort unless strict (raises OSError); event loop only, except the assignment manifest, which fs.assignments serialises with its lock."""

    # A failure only loses a tag (the file itself is saved), so it never fails the request;
    # on Windows os.replace can hit a sharing violation while a threadpool reader has the file open.
    p = d / marker
    try:
        if not data:
            p.unlink(missing_ok=True)
            return
        # Swap in a whole file: the threadpool tree/listing reads concurrently, and a torn read degrades to {}.
        tmp = d / (marker + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)
    except OSError as e:
        if strict:
            raise
        log.warning("%s not saved in %s: %s", marker, d, e)


def read_meta(d: Path) -> dict[str, dict]:
    """Read a lecture's {material name: {source?, filename?, attach?}} map; absent, corrupt or unreadable reads as {}."""

    raw = read_json_dict(d, MATERIAL_META_MARKER)
    meta = {}
    for name, v in raw.items():
        # A bare string is the pre-meta shape; removal tracked in docs/MIGRATIONS.md.
        if isinstance(v, str):
            v = {"source": v}
        if not isinstance(name, str) or not isinstance(v, dict):
            continue
        entry = {
            k: x
            for k, x in v.items()
            if k in _KEYS and isinstance(x, _KEYS[k]) and (x or k == "attach")
        }
        if entry:
            meta[name] = entry
    return meta


def write_meta(d: Path, meta: dict[str, dict], strict: bool = False) -> None:
    """Persist the map atomically, removing it once empty; best-effort unless strict (raises OSError); event loop only, except the assignment manifest, which fs.assignments serialises with its lock."""

    write_json_dict(
        d, MATERIAL_META_MARKER, {n: e for n, e in meta.items() if e}, strict
    )


def forget_meta(d: Path, name: str) -> None:
    """Drop one material's whole entry, leaving the sidecar untouched when it has none."""

    meta = read_meta(d)
    if meta.pop(name, None) is not None:
        write_meta(d, meta)
