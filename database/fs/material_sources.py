import json
import logging
import os
from pathlib import Path

from .paths import MATERIAL_SOURCES_MARKER

log = logging.getLogger("db")


def read_sources(d: Path) -> dict[str, str]:
    """Read a lecture's {material name: source} map; absent, corrupt or unreadable reads as {}."""

    try:
        raw = json.loads((d / MATERIAL_SOURCES_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, str) and v
    }


def write_sources(d: Path, sources: dict[str, str]) -> None:
    """Persist the map atomically, removing it once empty; best-effort, and call only from the event loop."""

    # A failure only loses a source tag (the PDF itself is saved), so it never fails the request;
    # on Windows os.replace can hit a sharing violation while a threadpool reader has the file open.
    p = d / MATERIAL_SOURCES_MARKER
    try:
        if not sources:
            p.unlink(missing_ok=True)
            return
        # Swap in a whole file: the threadpool tree/listing reads concurrently, and a torn read degrades to {}.
        tmp = d / (MATERIAL_SOURCES_MARKER + ".tmp")
        tmp.write_text(json.dumps(sources, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)
    except OSError as e:
        log.warning("material sources not saved in %s: %s", d, e)


def forget_source(d: Path, name: str) -> None:
    """Drop one material's entry, leaving the sidecar untouched when it has none."""

    sources = read_sources(d)
    if sources.pop(name, None) is not None:
        write_sources(d, sources)
