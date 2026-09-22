import sqlite3

import pytest
import timing
from services.errors import CodedError


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
        with pytest.raises(CodedError) as e:
            timing.record(operation, 1000, 2.5)
        assert (e.value.code, e.value.params) == ("timing_operation_required", {})
        assert _rows() == []

    @pytest.mark.parametrize(
        "operation", ["audio", "transcribe", "summarize", "pdf", "drive"]
    )
    def test_accepts_pipeline_operations(self, operation):
        assert timing.record(operation, 1000, 2.5) == {"status": "ok"}
        assert _rows() == [(operation, 1000, 2.5)]

    def test_rejects_unknown_operation(self):
        with pytest.raises(CodedError) as e:
            timing.record("trasncribe", 1000, 2.5)  # typo
        assert (e.value.code, e.value.params) == (
            "unknown_timing_operation",
            {"operation": "trasncribe"},
        )
        assert _rows() == []  # no dead bucket written

    @pytest.mark.parametrize("size", [0, -1])
    def test_rejects_non_positive_size(self, size):
        with pytest.raises(CodedError) as e:
            timing.record("download:curl", size, 2.5)
        assert (e.value.code, e.value.params) == (
            "invalid_timing_sample",
            {"field": "file_size_bytes", "value": size},
        )
        assert _rows() == []

    @pytest.mark.parametrize("duration", [0, -0.5])
    def test_rejects_non_positive_duration(self, duration):
        with pytest.raises(CodedError) as e:
            timing.record("download:curl", 1000, duration)
        assert (e.value.code, e.value.params) == (
            "invalid_timing_sample",
            {"field": "duration_seconds", "value": duration},
        )
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


class TestCorruptDb:
    def test_init_quarantines_garbage_db(self, tmp_path, monkeypatch):
        db = tmp_path / "state" / "timing.db"
        db.parent.mkdir()
        db.write_bytes(b"this is not a sqlite database" * 100)
        (db.parent / "timing.db.corrupt").write_bytes(b"older")
        monkeypatch.setattr(timing, "DB_PATH", db)

        timing.init_db()

        assert (db.parent / "timing.db.corrupt").read_bytes().startswith(b"this is not")
        assert timing.record("download:curl", 1000, 2.5) == {"status": "ok"}
        assert _rows() == [("download:curl", 1000, 2.5)]

    def test_timed_step_survives_corrupt_db(self):
        timing.DB_PATH.write_bytes(b"garbage" * 100)

        @timing.timed_pipeline("transcribe")
        def step(text):
            return text.upper()

        assert step("done") == "DONE"

    def test_get_stats_on_corrupt_db_is_not_enough_data(self):
        timing.DB_PATH.write_bytes(b"garbage" * 100)
        assert timing.get_stats("transcribe", 1000) == {"message": "not-enough-data"}
