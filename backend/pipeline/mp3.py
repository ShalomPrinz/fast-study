import struct
from pathlib import Path
from typing import Optional

# Layer III tables, keyed by the MPEG version id in the frame header (1 is reserved).
_SAMPLE_RATES = {
    3: (44100, 48000, 32000),  # MPEG-1
    2: (22050, 24000, 16000),  # MPEG-2
    0: (11025, 12000, 8000),  # MPEG-2.5
}
_BITRATES_V1 = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
_BITRATES_V2 = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0)
_BITRATES = {3: _BITRATES_V1, 2: _BITRATES_V2, 0: _BITRATES_V2}
_SAMPLES_PER_FRAME = {3: 1152, 2: 576, 0: 576}
# Side-info length between the frame header and a Xing/Info tag, as (stereo, mono).
_SIDE_INFO = {3: (32, 17), 2: (17, 9), 0: (17, 9)}

# Enough to cover the first frame and its Xing/Info tag; the scan starts past any ID3v2 tag.
_WINDOW = 8192


def _parse_frame_header(h: bytes) -> Optional[dict]:
    """Decode a 4-byte MPEG Layer III frame header, or None when these bytes aren't one."""

    if len(h) < 4 or h[0] != 0xFF or h[1] & 0xE0 != 0xE0:
        return None
    version = (h[1] >> 3) & 3
    layer = (h[1] >> 1) & 3
    bitrate_index = h[2] >> 4
    rate_index = (h[2] >> 2) & 3
    # Reserved version, a layer other than III, and the free/bad bitrate indices all
    # mean the tables below don't apply — treat the bytes as a false sync.
    if version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3:
        return None
    mono = (h[3] >> 6) & 3 == 3
    return {
        "sample_rate": _SAMPLE_RATES[version][rate_index],
        "bitrate": _BITRATES[version][bitrate_index] * 1000,
        "samples_per_frame": _SAMPLES_PER_FRAME[version],
        "xing_offset": 4 + _SIDE_INFO[version][mono],
    }


def read_duration(path: Path) -> Optional[float]:
    """Return an mp3's duration in seconds from its header, or None when it can't be read.

    Header parse instead of ffprobe: one read, and one fewer binary in the installer."""

    try:
        with open(path, "rb") as f:
            size = f.seek(0, 2)
            f.seek(0)
            head = f.read(10)
            start = 0
            if head[:3] == b"ID3":
                # Syncsafe length: four 7-bit bytes, so it can never hold a false 0xFF sync.
                start = 10 + (head[6] << 21 | head[7] << 14 | head[8] << 7 | head[9])
            f.seek(start)
            window = f.read(_WINDOW)

        for i in range(len(window) - 3):
            frame = _parse_frame_header(window[i : i + 4])
            if frame is None:
                continue
            xing = i + frame["xing_offset"]
            if window[xing : xing + 4] in (b"Xing", b"Info"):
                flags = struct.unpack(">I", window[xing + 4 : xing + 8])[0]
                if flags & 1:  # bit 0: the frame count field follows the flags
                    frames = struct.unpack(">I", window[xing + 8 : xing + 12])[0]
                    return frames * frame["samples_per_frame"] / frame["sample_rate"]
            # No frame count: the file is CBR, so its bytes divide by the bitrate.
            return (size - start - i) * 8 / frame["bitrate"]
        return None
    except Exception:
        return None
