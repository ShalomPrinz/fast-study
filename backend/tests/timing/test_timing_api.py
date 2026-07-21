from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


class TestPostTiming:
    def test_records_and_shows_up_in_stats(self):
        body = {"operation": "download:curl", "file_size_bytes": 1000, "duration_seconds": 4.0}
        assert client.post("/timing", json=body).json() == {"status": "ok"}

        stats = client.get("/timing/download:curl", params={"file_size_bytes": 1000}).json()
        assert stats["average"] == 4.0

    def test_rejects_non_positive_sample(self):
        body = {"operation": "download:curl", "file_size_bytes": 0, "duration_seconds": 4.0}
        assert client.post("/timing", json=body).json()["status"] == "error"

        stats = client.get("/timing/download:curl", params={"file_size_bytes": 1000}).json()
        assert stats == {"message": "not-enough-data"}
