import os
from unittest.mock import patch

import main
import pytest
from fastapi.testclient import TestClient
from services import providers, settings

client = TestClient(main.app)


class TestConfigOptions:
    def test_lists_providers_without_their_probe_url(self):
        body = client.get("/config/options").json()
        assert body["gemini_models"] == settings.GEMINI_MODELS
        assert {p["id"] for p in body["providers"]} == set(providers.PROVIDERS)
        assert all("probe_url" not in p for p in body["providers"])

    def test_console_url_comes_from_the_provider_table(self):
        body = client.get("/config/options").json()
        groq = next(p for p in body["providers"] if p["id"] == "groq")
        assert groq["console_url"] == providers.PROVIDERS["groq"]["console_url"]
        assert groq["key_prefix"] == "gsk_"


class TestPostConfig:
    # setenv first so monkeypatch restores what the endpoint writes into os.environ.
    @pytest.fixture(autouse=True)
    def _isolate_env(self, monkeypatch):
        for var in ("GEMINI_API_KEY", "GROQ_API_KEY", "GEMINI_MODEL", "DRIVE_ENABLED"):
            monkeypatch.setenv(var, "before")

    def test_applies_only_the_fields_sent(self):
        body = client.post("/config", json={"gemini_model": "gemini-x"}).json()
        assert body == {"status": "ok", "applied": ["gemini_model"]}
        assert settings.gemini_model() == "gemini-x"
        assert os.environ["GEMINI_API_KEY"] == "before"

    def test_a_key_is_never_echoed_back(self):
        response = client.post("/config", json={"groq_api_key": "gsk_secret"})
        assert "gsk_secret" not in response.text
        assert os.environ["GROQ_API_KEY"] == "gsk_secret"

    def test_drive_toggle_reaches_the_runner_with_no_restart(self):
        client.post("/config", json={"drive_enabled": False})
        assert main.runner.enabled_steps()[-1] == "pdf"
        client.post("/config", json={"drive_enabled": True})
        assert main.runner.enabled_steps()[-1] == "drive"


class TestProbeKey:
    def test_returns_the_probe_verdict(self):
        with patch.object(providers, "probe_key", return_value="rejected") as probe:
            body = client.post(
                "/config/probe-key", json={"provider": "gemini", "key": "AIza-bad"}
            ).json()
        assert body == {"result": "rejected"}
        assert probe.call_args.args == ("gemini", "AIza-bad")

    def test_unknown_provider_is_an_error_envelope(self):
        body = client.post(
            "/config/probe-key", json={"provider": "openai", "key": "x"}
        ).json()
        assert body["status"] == "error"
        assert "openai" in body["message"]


class TestDisabledStep:
    def test_run_drive_is_refused_while_drive_is_off(self, monkeypatch):
        monkeypatch.setenv("DRIVE_ENABLED", "false")
        with patch.object(main.runner, "try_run_step") as run:
            body = client.post("/courses/C/lectures/L/run/drive").json()
        assert body == {"status": "error", "message": "drive is disabled in settings"}
        run.assert_not_called()

    def test_run_pdf_is_unaffected(self, monkeypatch):
        monkeypatch.setenv("DRIVE_ENABLED", "false")
        with (
            patch.object(main.runner.db_client, "file_exists", return_value=True),
            patch.object(main.runner, "try_run_step", return_value="started") as run,
        ):
            body = client.post("/courses/C/lectures/L/run/pdf").json()
        assert body == {"status": "started"}
        run.assert_called_once()
