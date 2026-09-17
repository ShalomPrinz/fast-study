"""MP4 header walk: mvhd v0/v1, box layouts, and every unreadable case returning None."""

import struct

from fs.mp4 import read_duration
from fs.tree import read_course


def box(kind: bytes, payload: bytes) -> bytes:
    """A plain 32-bit-size box."""

    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def mvhd_v0(timescale: int, duration: int) -> bytes:
    """A version-0 mvhd box with the given timescale and duration."""

    return box(b"mvhd", bytes(4) + bytes(8) + struct.pack(">II", timescale, duration) + bytes(80))


def mvhd_v1(timescale: int, duration: int) -> bytes:
    """A version-1 mvhd box with the given timescale and 64-bit duration."""

    return box(b"mvhd", b"\x01" + bytes(3) + bytes(16) + struct.pack(">IQ", timescale, duration) + bytes(80))


FTYP = box(b"ftyp", b"isom" + bytes(4))


def write(tmp_path, data: bytes):
    """Write bytes to video.mp4 under tmp_path and return the path."""

    p = tmp_path / "video.mp4"
    p.write_bytes(data)
    return p


def test_v0_mvhd(tmp_path):
    p = write(tmp_path, FTYP + box(b"moov", mvhd_v0(1000, 90_500)))
    assert read_duration(p) == 90.5


def test_v1_mvhd(tmp_path):
    p = write(tmp_path, FTYP + box(b"moov", box(b"iods", bytes(8)) + mvhd_v1(600, 600 * 4000)))
    assert read_duration(p) == 4000.0


def test_moov_after_large_mdat(tmp_path):
    p = write(tmp_path, FTYP + box(b"mdat", bytes(1_000_000)) + box(b"moov", mvhd_v0(30, 300)))
    assert read_duration(p) == 10.0


def test_largesize_box(tmp_path):
    payload = bytes(5000)
    mdat = struct.pack(">I4sQ", 1, b"mdat", 16 + len(payload)) + payload
    p = write(tmp_path, FTYP + mdat + box(b"moov", mvhd_v0(1, 42)))
    assert read_duration(p) == 42.0


def test_size_zero_last_box_runs_to_eof(tmp_path):
    moov_payload = mvhd_v0(1, 7)
    p = write(tmp_path, FTYP + struct.pack(">I4s", 0, b"moov") + moov_payload)
    assert read_duration(p) == 7.0


def test_truncated_file(tmp_path):
    full = FTYP + box(b"mdat", bytes(1000)) + box(b"moov", mvhd_v0(1, 42))
    assert read_duration(write(tmp_path, full[:500])) is None


def test_no_moov_yet(tmp_path):
    assert read_duration(write(tmp_path, FTYP + box(b"mdat", bytes(100)))) is None


def test_non_mp4_bytes(tmp_path):
    assert read_duration(write(tmp_path, b"this is not an mp4 file at all")) is None
    assert read_duration(write(tmp_path, b"")) is None


def test_missing_file(tmp_path):
    assert read_duration(tmp_path / "nope.mp4") is None


def test_zero_duration_and_zero_timescale(tmp_path):
    assert read_duration(write(tmp_path, FTYP + box(b"moov", mvhd_v0(1000, 0)))) is None
    assert read_duration(write(tmp_path, FTYP + box(b"moov", mvhd_v0(0, 100)))) is None


def test_tree_entry_carries_duration(data_root):
    lec = data_root / "Algo" / "Lecture 1"
    lec.mkdir(parents=True)
    (lec / "video.mp4").write_bytes(FTYP + box(b"moov", mvhd_v0(1, 125)))
    (data_root / "Algo" / "Lecture 2").mkdir()
    lectures = {entry["name"]: entry for entry in read_course("Algo")["lectures"]}
    assert lectures["Lecture 1"]["files"]["video.mp4"]["duration"] == 125.0
    assert lectures["Lecture 2"]["files"]["video.mp4"]["duration"] is None
    assert "duration" not in lectures["Lecture 1"]["files"]["summary.pdf"]
