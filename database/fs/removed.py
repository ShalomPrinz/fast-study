import json
import os
from pathlib import Path

from .paths import REMOVABLE_FILES, REMOVED_MARKER


def read_removed(d: Path) -> list[str]:
    """Read a lecture's removed-file record in REMOVABLE_FILES order; absent, corrupt or unreadable reads as []."""

    try:
        raw = json.loads((d / REMOVED_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(raw, list):
        return []
    return [f for f in REMOVABLE_FILES if f in raw]


def write_removed(d: Path, names: list[str]) -> None:
    """Persist the record atomically, removing it once empty; call only from the event loop."""

    # Swapped in whole, so a threadpool tree read never sees a torn file.
    p = d / REMOVED_MARKER
    record = [f for f in REMOVABLE_FILES if f in names]
    if not record:
        p.unlink(missing_ok=True)
        return
    tmp = d / (REMOVED_MARKER + ".tmp")
    tmp.write_text(json.dumps(record), encoding="utf-8")
    os.replace(tmp, p)


def forget_removed(d: Path, name: str) -> None:
    """Drop one name from the record because that file is back, leaving the sidecar untouched otherwise."""

    record = read_removed(d)
    if name in record:
        record.remove(name)
        write_removed(d, record)
