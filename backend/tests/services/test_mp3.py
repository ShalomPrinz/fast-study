"""MP3 header parse: the Xing/Info frame count, the CBR fallback, an ID3v2 tag in
front, false syncs, and every unreadable case returning None."""

import shutil
import struct
import subprocess

import pytest
from services.errors import CodedError
from services.mp3 import read_duration
from transcribe import get_duration

# MPEG-2 Layer III, 16 kHz, 32 kbps, mono — what strip_audio's ffmpeg flags produce.
V2_MONO = bytes([0xFF, 0xF3, 0x48, 0xC0])
V2_MONO_XING = 4 + 9  # side info for an MPEG-2 mono frame

# MPEG-1 Layer III, 44.1 kHz, 128 kbps, stereo — the other side-info row.
V1_STEREO = bytes([0xFF, 0xFB, 0x90, 0x00])
V1_STEREO_XING = 4 + 32


def frame(header: bytes, xing_offset: int, frames: int | None, size: int) -> bytes:
    """One frame padded to `size` bytes, carrying an Info tag when `frames` is given."""

    body = bytearray(size)
    body[: len(header)] = header
    if frames is not None:
        tag = b"Info" + struct.pack(
            ">II", 1, frames
        )  # flags bit 0: frame count present
        body[xing_offset : xing_offset + len(tag)] = tag
    return bytes(body)


def id3(payload_len: int) -> bytes:
    """An ID3v2 tag header plus `payload_len` zero bytes, with the syncsafe length."""

    syncsafe = bytes(
        [
            (payload_len >> 21) & 0x7F,
            (payload_len >> 14) & 0x7F,
            (payload_len >> 7) & 0x7F,
            payload_len & 0x7F,
        ]
    )
    return b"ID3\x04\x00\x00" + syncsafe + bytes(payload_len)


def write(tmp_path, data: bytes):
    """Write bytes to audio.mp3 under tmp_path and return the path."""

    p = tmp_path / "audio.mp3"
    p.write_bytes(data)
    return p


def test_xing_frame_count(tmp_path):
    p = write(tmp_path, frame(V2_MONO, V2_MONO_XING, 1000, 144))
    assert read_duration(p) == pytest.approx(1000 * 576 / 16000)


def test_xing_mpeg1_stereo(tmp_path):
    p = write(tmp_path, frame(V1_STEREO, V1_STEREO_XING, 500, 417))
    assert read_duration(p) == pytest.approx(500 * 1152 / 44100)


def test_id3_tag_is_skipped(tmp_path):
    # The tag body looks like frames, so a parse that didn't skip it would sync inside it.
    tag = bytearray(id3(2048))
    tag[10:] = V2_MONO * 512
    p = write(tmp_path, bytes(tag) + frame(V2_MONO, V2_MONO_XING, 1000, 144))
    assert read_duration(p) == pytest.approx(1000 * 576 / 16000)


def test_cbr_fallback_without_xing(tmp_path):
    # 100 frames of 144 bytes at 32 kbps = 3.6 s of audio.
    p = write(tmp_path, frame(V2_MONO, V2_MONO_XING, None, 144 * 100))
    assert read_duration(p) == pytest.approx(3.6)


def test_cbr_fallback_measures_from_the_first_frame(tmp_path):
    # The ID3 tag's bytes are not audio, so they must not count towards the duration.
    p = write(tmp_path, id3(1024) + frame(V2_MONO, V2_MONO_XING, None, 144 * 100))
    assert read_duration(p) == pytest.approx(3.6)


def test_false_sync_is_skipped(tmp_path):
    # 0xFF 0xEB passes the sync bits but names the reserved MPEG version — keep scanning.
    p = write(tmp_path, b"\xff\xeb\x48\xc0" + frame(V2_MONO, V2_MONO_XING, 1000, 144))
    assert read_duration(p) == pytest.approx(1000 * 576 / 16000)


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"not an mp3 at all",
        bytes(4096),  # all zeroes: never syncs
        b"\xff\xf3\x08\xc0" + bytes(140),  # bitrate index 0 (free) — unmeasurable
    ],
    ids=["empty", "text", "zeroes", "free-bitrate"],
)
def test_unreadable_returns_none(tmp_path, data):
    assert read_duration(write(tmp_path, data)) is None


def test_missing_file_returns_none(tmp_path):
    assert read_duration(tmp_path / "nope.mp3") is None


def test_get_duration_raises_on_unreadable(tmp_path):
    p = write(tmp_path, b"not an mp3 at all")
    with pytest.raises(CodedError) as e:
        get_duration(str(p))
    assert (e.value.code, e.value.params) == ("unreadable_audio", {"file": p.name})


def _ffmpeg_available():
    return shutil.which("ffmpeg") is not None


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not installed")
def test_matches_a_real_encode(tmp_path):
    """The one test that would catch format drift: a real ffmpeg mp3, same flags as strip_audio."""

    out = tmp_path / "audio.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=7",
            "-vn",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-b:a",
            "32k",
            str(out),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Encoder delay puts the tagged length a fraction of a frame over the source.
    assert get_duration(str(out)) == pytest.approx(7.0, abs=0.1)
