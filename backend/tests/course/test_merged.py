import asyncio
import io
import threading
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
import timing
from course import merged
from pipeline import runner
from pypdf import PdfReader, PdfWriter
from services.db_client import DbClientError

NODE = {
    "name": "C",
    "lectures": [
        {
            "name": "Lecture 1",
            "files": {"summary.pdf": {"exists": True, "mtime": 100.0}},
        },
        {
            "name": "Lecture 2",
            "files": {"summary.pdf": {"exists": True, "mtime": 200.0}},
        },
        {
            "name": "Lecture 3",
            "files": {"summary.pdf": {"exists": False, "mtime": None}},
        },
    ],
    "recitations": [
        {
            "name": "Recitation 1",
            "files": {"summary.pdf": {"exists": True, "mtime": 300.0}},
        }
    ],
}
PARTS = [
    merged.Part(name="Lecture 1", kind="lecture"),
    merged.Part(name="Recitation 1", kind="recitation"),
]


def _pdf_bytes(pages=1) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(100, 100)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def clean():
    for d in (merged._in_flight, merged._errors, merged._locks):
        d.clear()
    yield
    for d in (merged._in_flight, merged._errors, merged._locks):
        d.clear()


@pytest.fixture
def db():
    """The database faked: one course tree, a free title, parts that are real small PDFs."""

    written = {}
    with (
        patch.object(merged.db_client, "get_tree", side_effect=lambda: [NODE]),
        patch.object(
            merged.db_client,
            "get_merged",
            side_effect=lambda c, t: {
                "name": t,
                "entry": written.get(t, {}).get("entry"),
            },
        ),
        patch.object(
            merged.db_client, "get_file_bytes", side_effect=lambda *a: _pdf_bytes()
        ),
        patch.object(
            merged.db_client,
            "put_merged_pdf",
            side_effect=lambda c, n, data: written.setdefault(n, {}).update(pdf=data),
        ),
        patch.object(
            merged.db_client,
            "patch_merged_meta",
            side_effect=lambda c, t, e: written.setdefault(t, {}).update(entry=e),
        ),
        patch.object(merged.db_client, "notify") as notify,
    ):
        written["notify"] = notify
        yield written


def _req(title="T", parts=PARTS, overwrite=False):
    return merged.MergeRequest(title=title, parts=parts, overwrite=overwrite)


class TestValidate:
    def test_title_with_only_separators_is_required(self, db):
        with pytest.raises(merged.Refused) as e:
            merged.validate(_req(title=" / \\ "), "C")
        assert (e.value.status, e.value.body["code"]) == (400, "merged_title_required")

    @pytest.mark.parametrize("title", [".", "..", " ... ", "./"])
    def test_a_dots_only_title_is_refused_before_any_db_call(self, db, title):
        with pytest.raises(merged.Refused) as e:
            merged.validate(_req(title=title), "C")
        assert (e.value.status, e.value.body["code"]) == (
            400,
            "name_has_no_legal_characters",
        )
        assert e.value.body["params"] == {"name": title}
        merged.db_client.get_merged.assert_not_called()
        merged.db_client.get_tree.assert_not_called()

    def test_no_parts_is_required_after_the_title(self, db):
        with pytest.raises(merged.Refused) as e:
            merged.validate(_req(parts=[]), "C")
        assert (e.value.status, e.value.body["code"]) == (400, "merged_parts_required")

    def test_the_title_is_cleaned_and_the_stored_name_returned(self, db):
        assert merged.validate(_req(title=" a/b\\c "), "C") == ("abc", "abc")

    @pytest.mark.parametrize(
        "code,status",
        [("course_not_found", 404), ("name_has_no_legal_characters", 400)],
    )
    def test_the_databases_refusals_pass_through(self, db, code, status):
        with patch.object(
            merged.db_client, "get_merged", side_effect=DbClientError("x", code, a=1)
        ):
            with pytest.raises(merged.Refused) as e:
                merged.validate(_req(), "C")
        assert (e.value.status, e.value.body["code"]) == (status, code)
        assert e.value.body["params"] == {"a": 1}

    def test_an_unnamed_storage_failure_propagates(self, db):
        with patch.object(
            merged.db_client,
            "get_merged",
            side_effect=DbClientError("x", "storage_error"),
        ):
            with pytest.raises(DbClientError):
                merged.validate(_req(), "C")

    def test_an_existing_title_is_refused_unless_overwriting(self, db):
        db["T"] = {"entry": {"title": "T"}}
        with pytest.raises(merged.Refused) as e:
            merged.validate(_req(), "C")
        assert e.value.status == 409
        assert e.value.body["code"] == "merged_pdf_exists"
        assert e.value.body["params"] == {"title": "T"}
        assert merged.validate(_req(overwrite=True), "C") == ("T", "T")

    def test_the_exists_refusal_names_the_stored_title_not_the_typed_one(self, db):
        db["ab"] = {"entry": {"title": "Stored Title"}}
        with pytest.raises(merged.Refused) as e:
            merged.validate(_req(title="a/b"), "C")
        assert e.value.body["params"] == {"title": "Stored Title"}

    @pytest.mark.parametrize(
        "part",
        [
            merged.Part(name="Lecture 3", kind="lecture"),  # no summary.pdf
            merged.Part(name="Nope", kind="lecture"),  # not in the course
            merged.Part(name="Recitation 1", kind="lecture"),  # wrong kind
        ],
    )
    def test_a_part_without_a_summary_pdf_is_refused(self, db, part):
        with pytest.raises(merged.Refused) as e:
            merged.validate(_req(parts=[PARTS[0], part]), "C")
        assert e.value.status == 409
        assert e.value.body["code"] == "merged_part_missing"
        assert e.value.body["params"] == {"name": part.name, "kind": part.kind}


def _start_and_wait(*requests):
    async def go():
        started = [merged.try_start("C", t, t, p) for t, p in requests]
        while merged._in_flight:
            await asyncio.sleep(0.01)
        return started

    return asyncio.run(go())


class TestRun:
    def test_a_merge_writes_the_pdf_then_the_meta_and_records_timing(self, db):
        assert _start_and_wait(("T", PARTS)) == ["started"]
        assert len(PdfReader(io.BytesIO(db["T"]["pdf"])).pages) == 2
        entry = db["T"]["entry"]
        assert entry["title"] == "T"
        assert datetime.fromisoformat(entry["created_at"]).tzinfo is not None
        assert entry["parts"] == [
            {
                "name": "Lecture 1",
                "kind": "lecture",
                "pdf_mtime": datetime.fromtimestamp(100.0, timezone.utc).isoformat(),
            },
            {
                "name": "Recitation 1",
                "kind": "recitation",
                "pdf_mtime": datetime.fromtimestamp(300.0, timezone.utc).isoformat(),
            },
        ]
        assert merged.errors() == {}

    def test_timing_is_recorded_under_merge_pdf_with_the_summed_input_bytes(self, db):
        with patch.object(merged.timing, "record") as record:
            _start_and_wait(("T", PARTS))
        op, size, seconds = record.call_args.args
        assert (op, size) == ("merge_pdf", 2 * len(_pdf_bytes()))
        assert seconds > 0

    def test_merge_pdf_is_an_allowed_timing_operation(self):
        assert timing.record("merge_pdf", 10, 1.0) == {"status": "ok"}

    def test_labels_are_the_hebrew_display_names(self, db):
        with patch.object(merged, "join_pdfs", wraps=merged.join_pdfs) as join:
            _start_and_wait(("T", PARTS))
        assert join.call_args.args[1] == ["הרצאה 1", "תרגול 1"]
        assert join.call_args.args[2] == "T"

    def test_notifies_on_start_run_and_end(self, db):
        _start_and_wait(("T", PARTS))
        assert db["notify"].call_count >= 3

    def test_a_second_trigger_of_the_same_name_is_busy(self, db):
        async def go():
            first = merged.try_start("C", "T", "T", PARTS)
            second = merged.try_start("C", "T", "T", PARTS)
            while merged._in_flight:
                await asyncio.sleep(0.01)
            return first, second

        assert asyncio.run(go()) == ("started", "busy")

    def test_merges_of_one_course_run_one_at_a_time(self, db):
        gate = threading.Event()

        def slow_fetch(*_args):
            gate.wait(5)
            return _pdf_bytes()

        merged.db_client.get_file_bytes.side_effect = slow_fetch

        async def go():
            merged.try_start("C", "A", "A", PARTS)
            merged.try_start("C", "B", "B", PARTS)
            await asyncio.sleep(0.1)
            seen = {i["lecture"]: i["waiting"] for i in merged.in_flight()}
            gate.set()
            while merged._in_flight:
                await asyncio.sleep(0.01)
            return seen

        try:
            assert asyncio.run(go()) == {"A": False, "B": True}
        finally:
            gate.set()
        assert "pdf" in db["A"] and "pdf" in db["B"]

    def test_started_at_is_reset_when_the_lock_is_acquired(self, db):
        gate = threading.Event()

        def slow_fetch(*_args):
            gate.wait(5)
            return _pdf_bytes()

        merged.db_client.get_file_bytes.side_effect = slow_fetch

        async def go():
            merged.try_start("C", "A", "A", PARTS)
            merged.try_start("C", "B", "B", PARTS)
            b = merged._in_flight[merged.skey("C", "B")]
            queued_at = b["started_at"]
            await asyncio.sleep(0.05)
            gate.set()
            while b["waiting"]:
                await asyncio.sleep(0.01)
            ran_at = b["started_at"]
            while merged._in_flight:
                await asyncio.sleep(0.01)
            return queued_at, ran_at

        try:
            queued_at, ran_at = asyncio.run(go())
        finally:
            gate.set()
        assert ran_at > queued_at

    def test_in_flight_item_shape(self, db):
        async def go():
            merged.try_start("C", "T", "T", PARTS)
            item = merged.in_flight()[0]
            while merged._in_flight:
                await asyncio.sleep(0.01)
            return item

        item = asyncio.run(go())
        assert item.keys() == {
            "course", "lecture", "kind", "step", "started_at", "waiting", "size",
        }  # fmt: skip
        assert (item["lecture"], item["kind"], item["step"]) == (
            "T",
            "merged",
            "merge_pdf",
        )

    def test_in_flight_size_is_null_then_the_part_bytes_by_the_join(self, db):
        seen = {}

        def join(inputs, labels, title, out):
            seen["size"] = merged.in_flight()[0]["size"]
            return merged.join_pdfs(inputs, labels, title, out)

        async def go():
            merged.try_start("C", "T", "T", PARTS)
            seen["before"] = merged.in_flight()[0]["size"]
            while merged._in_flight:
                await asyncio.sleep(0.01)

        with patch.object(merged, "join_pdfs", side_effect=join):
            asyncio.run(go())
        assert seen["before"] is None
        assert seen["size"] == 2 * len(_pdf_bytes())

    def test_a_vanished_part_file_is_merged_part_missing(self, db):
        merged.db_client.get_file_bytes.side_effect = DbClientError(
            "x", "file_not_found", file="summary.pdf"
        )
        _start_and_wait(("T", PARTS))
        record = merged.errors()[merged.skey("C", "T")]
        assert record["code"] == "merged_part_missing"
        assert record["params"] == {"name": "Lecture 1", "kind": "lecture"}
        assert record["step"] == "merge_pdf"
        assert record["provider"] is None and record["blocked"] is False
        assert "T" not in db or "pdf" not in db["T"]

    def test_a_pypdf_failure_carries_its_text_verbatim(self, db):
        merged.db_client.get_file_bytes.side_effect = lambda *a: b"not a pdf"
        _start_and_wait(("T", PARTS))
        record = merged.errors()[merged.skey("C", "T")]
        assert record["code"] == "merge_pdf_failed"
        assert record["params"]["detail"]
        assert record["params"]["detail"] in record["message"]

    def test_file_locked_passes_through_and_leaves_no_meta(self, db):
        merged.db_client.put_merged_pdf.side_effect = DbClientError(
            "locked", "file_locked", file="T.pdf"
        )
        _start_and_wait(("T", PARTS))
        record = merged.errors()[merged.skey("C", "T")]
        assert (record["code"], record["params"]) == ("file_locked", {"file": "T.pdf"})
        assert "entry" not in db.get("T", {})

    def test_a_later_success_clears_the_error(self, db):
        merged.db_client.get_file_bytes.side_effect = lambda *a: b"junk"
        _start_and_wait(("T", PARTS))
        assert merged.errors()
        merged.db_client.get_file_bytes.side_effect = lambda *a: _pdf_bytes()
        _start_and_wait(("T", PARTS))
        assert merged.errors() == {}

    def test_accepting_a_new_merge_clears_the_old_error_at_once(self, db):
        merged.db_client.get_file_bytes.side_effect = lambda *a: b"junk"
        _start_and_wait(("T", PARTS))
        assert merged.errors()

        async def go():
            assert merged.try_start("C", "T", "T", PARTS) == "started"
            cleared = merged.errors() == {}
            while merged._in_flight:
                await asyncio.sleep(0.01)
            return cleared

        assert asyncio.run(go())
        assert list(merged.errors()) == [merged.skey("C", "T")]  # failed again, fresh

    def test_another_names_success_keeps_the_error(self, db):
        merged.db_client.get_file_bytes.side_effect = lambda *a: b"junk"
        _start_and_wait(("T", PARTS))
        merged.db_client.get_file_bytes.side_effect = lambda *a: _pdf_bytes()
        _start_and_wait(("U", PARTS))
        assert list(merged.errors()) == [merged.skey("C", "T")]


class TestStatusAndPrune:
    def test_status_carries_merged_items_beside_the_runners(self, db):
        merged._in_flight["C||T||merged"] = {"kind": "merged"}
        merged._errors["C||T||merged"] = {"code": "x"}
        status = runner.get_status()
        assert {"kind": "merged"} in status["in_flight"]
        assert status["errors"]["C||T||merged"] == {"code": "x"}

    def test_prune_drops_the_errors_of_a_course_gone_from_the_tree(self, db):
        merged._errors["C||T||merged"] = {"code": "x"}
        merged._errors["Gone||T||merged"] = {"code": "x"}
        assert not runner._errors  # the early return must not skip merged errors
        with patch.object(runner.db_client, "get_tree", return_value=[{"name": "C"}]):
            asyncio.run(runner.prune_stale_errors())
        assert list(merged._errors) == ["C||T||merged"]

    def test_prune_keeps_an_error_written_during_the_tree_fetch(self, db):
        old = {"code": "x"}
        merged._errors["Gone||T||merged"] = old

        def tree():
            merged._errors["Gone||T||merged"] = {"code": "new"}
            return []

        with patch.object(runner.db_client, "get_tree", side_effect=tree):
            asyncio.run(runner.prune_stale_errors())
        assert merged._errors["Gone||T||merged"] == {"code": "new"}
