from unittest.mock import patch

import backend_main
from fastapi.testclient import TestClient
from services.db_client import DbClientError

client = TestClient(backend_main.app)


class TestRunStep:
    def test_unknown_step_is_a_404(self):
        response = client.post("/courses/C/lectures/L/run/nope")
        assert response.status_code == 404
        assert response.json() == {
            "error": "Unknown step: nope",
            "code": "unknown_step",
            "params": {"step": "nope"},
        }

    def test_missing_prerequisite_is_a_409(self):
        with (
            patch.object(
                backend_main.runner.db_client, "file_exists", return_value=False
            ),
            patch.object(backend_main.runner, "try_run_step") as run,
        ):
            response = client.post("/courses/C/lectures/L/run/pdf")
        assert response.status_code == 409
        assert response.json() == {
            "error": "summary.md is required — run Summarize first",
            "code": "missing_prerequisite",
            # The machine step id, not the "Summarize" label the sentence carries.
            "params": {"file": "summary.md", "step": "summarize"},
        }
        run.assert_not_called()

    def test_an_unreachable_database_is_a_readable_500(self):
        """With database/ down the prerequisite check raises out of the route; the body still
        parses, which is the whole point of the app-level backstop."""

        with patch.object(
            backend_main.runner.db_client,
            "file_exists",
            side_effect=DbClientError("connection refused", "storage_error"),
        ):
            response = client.post("/courses/C/lectures/L/run/pdf")
        assert response.status_code == 500
        assert response.json() == {
            "error": "connection refused",
            "code": "storage_unavailable",
            "params": {"detail": "connection refused"},
        }

    def test_an_invalid_kind_is_fastapi_s_own_422(self):
        response = client.post("/courses/C/lectures/L/run/pdf?kind=zzz")
        assert response.status_code == 422
        assert "detail" in response.json()


class TestOverviewGenerate:
    def test_unknown_from_phase_is_a_400(self):
        response = client.post("/courses/C/overview/generate?from_phase=zzz")
        assert response.status_code == 400
        assert response.json() == {
            "error": "unknown phase: zzz",
            "code": "unknown_phase",
            "params": {"phase": "zzz"},
        }

    def test_unknown_extractor_is_a_400(self):
        response = client.post("/courses/C/overview/generate?extractors=nope")
        assert response.status_code == 400
        assert response.json() == {
            "error": "unknown extractor(s): nope",
            "code": "unknown_extractors",
            "params": {"slugs": "nope"},
        }

    def test_unknown_course_is_a_404(self):
        with patch.object(backend_main.db_client, "get_tree", return_value=[]):
            response = client.post("/courses/C/overview/generate")
        assert response.status_code == 404
        assert response.json() == {
            "error": "course not found: C",
            "code": "course_not_found",
            "params": {"course": "C"},
        }

    def test_an_unconfigured_data_root_is_a_409_naming_the_refusal(self):
        """The storage answered and refused for a reason the user can fix, so the route re-emits
        the peer's own code rather than letting the backstop call the storage unreachable."""

        with patch.object(
            backend_main.db_client,
            "get_tree",
            side_effect=DbClientError(
                "No data folder is configured", "data_root_not_configured"
            ),
        ):
            response = client.post("/courses/C/overview/generate")
        assert response.status_code == 409
        assert response.json() == {
            "error": "No data folder is configured",
            "code": "data_root_not_configured",
            "params": {},
        }

    def test_any_other_storage_failure_stays_the_500_backstop(self):
        with patch.object(
            backend_main.db_client,
            "get_tree",
            side_effect=DbClientError("connection refused", "storage_error"),
        ):
            response = client.post("/courses/C/overview/generate")
        assert response.status_code == 500
        assert response.json() == {
            "error": "connection refused",
            "code": "storage_unavailable",
            "params": {"detail": "connection refused"},
        }


class TestRunAll:
    def test_an_unconfigured_data_root_is_a_409_naming_the_refusal(self):
        with patch.object(
            backend_main.runner.db_client,
            "get_tree",
            side_effect=DbClientError(
                "No data folder is configured", "data_root_not_configured"
            ),
        ):
            response = client.post("/run-all")
        assert response.status_code == 409
        assert response.json()["code"] == "data_root_not_configured"

    def test_any_other_storage_failure_stays_the_500_backstop(self):
        with patch.object(
            backend_main.runner.db_client,
            "get_tree",
            side_effect=DbClientError("connection refused", "storage_error"),
        ):
            response = client.post("/run-all")
        assert response.status_code == 500
        assert response.json()["code"] == "storage_unavailable"


class TestHealth:
    def test_a_failed_tool_probe_passes_through_unchanged(self):
        """The probe record is lib/tools' to shape; /health relays it and re-words nothing."""

        record = {
            "state": "missing",
            "params": {"tool": "tectonic"},
        }
        tools = {"ffmpeg": "ok", "tectonic": record}
        with patch.object(backend_main, "tool_status", tools):
            body = client.get("/health").json()
        assert body == {"status": "ok", "tools": tools}
