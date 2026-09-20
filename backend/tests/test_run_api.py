from unittest.mock import patch

import backend_main
from fastapi.testclient import TestClient

client = TestClient(backend_main.app)


class TestRunStep:
    def test_unknown_step_is_a_404(self):
        response = client.post("/courses/C/lectures/L/run/nope")
        assert response.status_code == 404
        assert response.json() == {"error": "Unknown step: nope"}

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
            "error": "summary.md is required — run Summarize first"
        }
        run.assert_not_called()

    def test_an_invalid_kind_is_fastapi_s_own_422(self):
        response = client.post("/courses/C/lectures/L/run/pdf?kind=zzz")
        assert response.status_code == 422
        assert "detail" in response.json()


class TestOverviewGenerate:
    def test_unknown_from_phase_is_a_400(self):
        response = client.post("/courses/C/overview/generate?from_phase=zzz")
        assert response.status_code == 400
        assert response.json() == {"error": "unknown phase: zzz"}

    def test_unknown_extractor_is_a_400(self):
        response = client.post("/courses/C/overview/generate?extractors=nope")
        assert response.status_code == 400
        assert response.json() == {"error": "unknown extractor(s): nope"}

    def test_unknown_course_is_a_404(self):
        with patch.object(backend_main.db_client, "get_tree", return_value=[]):
            response = client.post("/courses/C/overview/generate")
        assert response.status_code == 404
        assert response.json() == {"error": "course not found: C"}
