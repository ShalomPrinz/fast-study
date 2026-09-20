import backend_main
from fastapi.testclient import TestClient

client = TestClient(backend_main.app)


class TestPostTiming:
    def test_records_and_shows_up_in_stats(self):
        body = {
            "operation": "download:curl",
            "file_size_bytes": 1000,
            "duration_seconds": 4.0,
        }
        assert client.post("/timing", json=body).json() == {"status": "ok"}

        stats = client.get(
            "/timing/download:curl", params={"file_size_bytes": 1000}
        ).json()
        assert stats["average"] == 4.0

    def test_rejects_non_positive_sample(self):
        body = {
            "operation": "download:curl",
            "file_size_bytes": 0,
            "duration_seconds": 4.0,
        }
        response = client.post("/timing", json=body)
        assert response.status_code == 400
        assert "file_size_bytes" in response.json()["error"]

        stats = client.get(
            "/timing/download:curl", params={"file_size_bytes": 1000}
        ).json()
        assert stats == {"message": "not-enough-data"}

    def test_rejects_unknown_operation(self):
        body = {
            "operation": "trasncribe",
            "file_size_bytes": 1000,
            "duration_seconds": 4.0,
        }
        response = client.post("/timing", json=body)
        assert response.status_code == 400
        assert response.json() == {"error": "unknown operation: trasncribe"}
