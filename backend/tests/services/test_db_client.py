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
