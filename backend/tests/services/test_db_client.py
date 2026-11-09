"""The one hop that loses the HTTP status: a database refusal becomes a pipeline step's
`message`, so the peer's own code is all that survives it — `file_locked` above all."""

from unittest.mock import patch

import pytest
import requests
from services import db_client
from services.db_client import DbClientError


class FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._payload = payload
        self.text = text
        self.content = b"payload"

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def _answering(response):
    return patch.object(db_client._session, "request", return_value=response)


class TestForwardedCodes:
    def test_the_peers_code_and_params_ride_through(self):
        with _answering(
            FakeResponse(
                423,
                {
                    "error": "file is open in another program",
                    "code": "file_locked",
                    "params": {"file": "summary.md"},
                },
            )
        ):
            with pytest.raises(DbClientError) as e:
                db_client.put_file_bytes("C", "L", "lecture", "summary.md", b"x")
        assert str(e.value) == "file is open in another program"
        assert (e.value.code, e.value.params) == ("file_locked", {"file": "summary.md"})

    def test_a_codeless_refusal_falls_back_to_storage_error(self):
        with _answering(FakeResponse(500, {"error": "disk on fire"})):
            with pytest.raises(DbClientError) as e:
                db_client.get_tree()
        assert (e.value.code, e.value.params) == (
            "storage_error",
            {"detail": "disk on fire"},
        )

    def test_a_non_json_refusal_still_names_itself(self):
        with _answering(FakeResponse(502, text="<html>bad gateway</html>")):
            with pytest.raises(DbClientError) as e:
                db_client.get_tree()
        assert e.value.code == "storage_error"
        assert "502" in e.value.params["detail"]

    def test_an_unreachable_peer_is_a_storage_error_not_a_transport_exception(self):
        """With database/ down every caller must still see one exception type — it is what
        the route-level backstop turns into a body the frontend can parse."""

        with patch.object(
            db_client._session,
            "request",
            side_effect=requests.ConnectionError("connection refused"),
        ):
            with pytest.raises(DbClientError) as e:
                db_client.file_exists("C", "L", "lecture", "video.mp4")
        assert (e.value.code, e.value.params) == (
            "storage_error",
            {"detail": "connection refused"},
        )


class TestNotFound:
    def test_a_missing_lecture_file_names_the_lecture(self):
        with _answering(FakeResponse(404)):
            with pytest.raises(DbClientError) as e:
                db_client.get_file_bytes("C", "L", "lecture", "audio.mp3")
        assert e.value.code == "file_not_found"
        assert e.value.params == {"file": "audio.mp3", "course": "C", "lecture": "L"}

    def test_a_missing_overview_file_names_the_course(self):
        with _answering(FakeResponse(404)):
            with pytest.raises(DbClientError) as e:
                db_client.get_overview_file("C", "exam-hints.md")
        assert e.value.code == "overview_file_not_found"
        assert e.value.params == {"file": "exam-hints.md", "course": "C"}

    def test_a_vanished_lecture_is_forwarded_not_recoded_as_a_missing_file(self):
        with _answering(
            FakeResponse(
                404,
                {
                    "error": "lecture not found",
                    "code": "lecture_not_found",
                    "params": {"course": "C", "lecture": "L"},
                },
            )
        ):
            with pytest.raises(DbClientError) as e:
                db_client.get_file_bytes("C", "L", "lecture", "audio.mp3")
        assert (e.value.code, e.value.params) == (
            "lecture_not_found",
            {"course": "C", "lecture": "L"},
        )

    def test_the_peers_file_not_found_still_gains_the_lecture(self):
        with _answering(
            FakeResponse(
                404,
                {
                    "error": "Not found",
                    "code": "file_not_found",
                    "params": {"file": "a"},
                },
            )
        ):
            with pytest.raises(DbClientError) as e:
                db_client.get_file_bytes("C", "L", "lecture", "audio.mp3")
        assert e.value.params == {"file": "audio.mp3", "course": "C", "lecture": "L"}


class TestPutSummary:
    def _sent_params(self, **kwargs) -> dict:
        with _answering(FakeResponse(204)) as request:
            db_client.put_summary("C", "L", "lecture", "# s", **kwargs)
        return request.call_args.kwargs["params"]

    def test_new_ai_output_asks_for_a_fresh_summary(self):
        assert self._sent_params(fresh=True) == {"kind": "lecture", "fresh": "true"}

    def test_a_plain_write_omits_the_flag(self):
        assert self._sent_params() == {"kind": "lecture"}


class TestRemoveFiles:
    def test_posts_the_names_to_the_removed_route(self):
        with _answering(FakeResponse(204)) as request:
            db_client.remove_files("C 1", "L/1", "recitation", ["video.mp4"])
        method, url = request.call_args.args
        assert method == "POST"
        assert url.endswith("/courses/C%201/lectures/L%2F1/removed")
        assert request.call_args.kwargs["params"] == {"kind": "recitation"}
        assert request.call_args.kwargs["json"] == {"files": ["video.mp4"]}

    def test_a_locked_file_rides_through_as_its_code(self):
        body = {"error": "open", "code": "file_locked", "params": {"file": "audio.mp3"}}
        with _answering(FakeResponse(423, body)), pytest.raises(DbClientError) as e:
            db_client.remove_files("C", "L", "lecture", ["audio.mp3"])
        assert e.value.code == "file_locked"


# The conftest fixture replaces db_client.list_figures for every test, so the real one is kept here.
_REAL_LIST_FIGURES = db_client.list_figures


class TestFigures:
    def test_routes_and_kind(self):
        with _answering(FakeResponse(204)) as req:
            db_client.put_figure("C 1", "L", "recitation", "fig1.pdf", b"x")
            db_client.delete_figures("C 1", "L", "recitation")
        put, delete = (c.args + (c.kwargs,) for c in req.call_args_list)
        assert put[0] == "PUT" and put[1].endswith(
            "/courses/C%201/lectures/L/figures/fig1.pdf"
        )
        assert put[2]["params"] == {"kind": "recitation"} and put[2]["data"] == b"x"
        assert delete[0] == "DELETE" and delete[1].endswith("/lectures/L/figures")

    def test_list_and_get(self):
        with _answering(FakeResponse(200, {"figures": ["fig1.pdf", "fig2.png"]})):
            assert _REAL_LIST_FIGURES("C", "L", "lecture") == ["fig1.pdf", "fig2.png"]
        with _answering(FakeResponse(200, {})):
            assert _REAL_LIST_FIGURES("C", "L", "lecture") == []
        with _answering(FakeResponse(200)):
            assert db_client.get_figure("C", "L", "lecture", "fig1.pdf") == b"payload"

    def test_a_locked_clear_keeps_its_code(self):
        locked = FakeResponse(
            423, {"error": "locked", "code": "file_locked", "params": {}}
        )
        with _answering(locked), pytest.raises(DbClientError) as e:
            db_client.delete_figures("C", "L", "lecture")
        assert e.value.code == "file_locked"
