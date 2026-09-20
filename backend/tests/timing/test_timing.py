import sqlite3

import pytest
import timing


# conftest's autouse fixture already points timing.DB_PATH at a temp db.
def _rows():
    with sqlite3.connect(timing.DB_PATH) as conn:
        return conn.execute(
            "SELECT operation, file_size_bytes, duration_seconds FROM timing"
        ).fetchall()


class TestRecord:
    def test_records_sample(self):
        assert timing.record("download:curl", 1000, 2.5) == {"status": "ok"}
        assert _rows() == [("download:curl", 1000, 2.5)]

    def test_strips_operation(self):
        timing.record("  download:ytdlp  ", 10, 1.0)
        assert _rows()[0][0] == "download:ytdlp"

    @pytest.mark.parametrize("operation", ["", "   "])
    def test_rejects_blank_operation(self, operation):
        with pytest.raises(ValueError, match="operation is required"):
            timing.record(operation, 1000, 2.5)
        assert _rows() == []

    @pytest.mark.parametrize(
        "operation", ["audio", "transcribe", "summarize", "pdf", "drive"]
    )
    def test_accepts_pipeline_operations(self, operation):
        assert timing.record(operation, 1000, 2.5) == {"status": "ok"}
        assert _rows() == [(operation, 1000, 2.5)]

    def test_rejects_unknown_operation(self):
        with pytest.raises(ValueError, match="unknown operation"):
            timing.record("trasncribe", 1000, 2.5)  # typo
        assert _rows() == []  # no dead bucket written

    @pytest.mark.parametrize("size", [0, -1])
    def test_rejects_non_positive_size(self, size):
        with pytest.raises(ValueError, match="file_size_bytes"):
            timing.record("download:curl", size, 2.5)
        assert _rows() == []

    @pytest.mark.parametrize("duration", [0, -0.5])
    def test_rejects_non_positive_duration(self, duration):
        with pytest.raises(ValueError, match="duration_seconds"):
            timing.record("download:curl", 1000, duration)
        assert _rows() == []

    def test_round_trip_into_get_stats(self):
        assert timing.get_stats("download:curl", 2000) == {"message": "not-enough-data"}

        timing.record("download:curl", 1000, 1.0)
        timing.record("download:curl", 3000, 3.0)

        stats = timing.get_stats("download:curl", 2000)
        assert stats["shortest"] == 1.0
        assert stats["longest"] == 3.0
        assert stats["estimated"] == pytest.approx(2.0)

    def test_operations_are_separate_buckets(self):
        timing.record("download:curl", 1000, 1.0)
        assert timing.get_stats("download:ytdlp", 1000) == {
            "message": "not-enough-data"
        }
