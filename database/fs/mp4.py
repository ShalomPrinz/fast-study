import struct
from pathlib import Path
from typing import BinaryIO, Optional


def _find_box(f: BinaryIO, start: int, end: int, box_type: bytes) -> Optional[tuple[int, int]]:
    """Scan sibling box headers in [start, end) and return (payload_start, box_end) of the first `box_type`."""

    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        header = f.read(8)
        if len(header) < 8:
            return None
        size, kind = struct.unpack(">I4s", header)
        payload = pos + 8
        if size == 1:
            large = f.read(8)
            if len(large) < 8:
                return None
            size = struct.unpack(">Q", large)[0]
            payload = pos + 16
        elif size == 0:
            size = end - pos
        box_end = pos + size
        if box_end > end or box_end < payload:
            return None
        if kind == box_type:
            return payload, box_end
        pos = box_end
    return None


def read_duration(path: Path) -> Optional[float]:
    """Return an MP4's duration in seconds from moov/mvhd, or None when it can't be read.

    Header walk instead of ffprobe: a few seeks, fast enough to run on every tree read."""

    try:
        with open(path, "rb") as f:
            end = f.seek(0, 2)
            moov = _find_box(f, 0, end, b"moov")
            # No moov yet means the download is still in progress.
            if moov is None:
                return None
            mvhd = _find_box(f, moov[0], moov[1], b"mvhd")
            if mvhd is None:
                return None
            f.seek(mvhd[0])
            body = f.read(min(mvhd[1] - mvhd[0], 32))
            if len(body) < 4:
                return None
            if body[0] == 1:
                if len(body) < 32:
                    return None
                timescale, duration = struct.unpack(">IQ", body[20:32])
            else:
                if len(body) < 20:
                    return None
                timescale, duration = struct.unpack(">II", body[12:20])
            # Fragmented MP4 leaves mvhd duration at 0 — the real length lives in the fragments.
            if timescale == 0 or duration == 0:
                return None
            return duration / timescale
    except Exception:
        return None
