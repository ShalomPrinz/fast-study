import os

import pytest
from services import settings


class TestGeminiModel:
    def test_falls_back_to_the_curated_default(self, monkeypatch):
        monkeypatch.delenv("GEMINI_MODEL", raising=False)
        assert settings.gemini_model() == settings.GEMINI_MODELS[0]

    def test_environment_wins(self, monkeypatch):
        monkeypatch.setenv("GEMINI_MODEL", "gemini-x")
        assert settings.gemini_model() == "gemini-x"

    def test_blank_is_treated_as_unset(self, monkeypatch):
        monkeypatch.setenv("GEMINI_MODEL", "")
        assert settings.gemini_model() == settings.GEMINI_MODELS[0]


class TestDriveEnabled:
    def test_unset_is_off(self, monkeypatch):
        monkeypatch.delenv("DRIVE_ENABLED", raising=False)
        assert settings.drive_enabled() is False

    @pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", " on "])
    def test_truthy_values(self, monkeypatch, value):
        monkeypatch.setenv("DRIVE_ENABLED", value)
        assert settings.drive_enabled() is True

    @pytest.mark.parametrize("value", ["false", "0", "off", "", "maybe"])
    def test_everything_else_is_off(self, monkeypatch, value):
        monkeypatch.setenv("DRIVE_ENABLED", value)
        assert settings.drive_enabled() is False


class TestApplyConfig:
    # setenv first so monkeypatch restores what apply_config writes straight into os.environ.
    @pytest.fixture(autouse=True)
    def _isolate_env(self, monkeypatch):
        for var in (
            "GEMINI_API_KEY",
            "GEMINI_MODEL",
            "DRIVE_ENABLED",
            "GDRIVE_ROOT_FOLDER",
        ):
            monkeypatch.setenv(var, "")

    def test_writes_each_field_to_its_env_var(self):
        applied = settings.apply_config(
            {"gemini_api_key": "k1", "gdrive_root_folder": "Lectures"}
        )
        assert sorted(applied) == ["gdrive_root_folder", "gemini_api_key"]
        assert os.environ["GEMINI_API_KEY"] == "k1"
        assert os.environ["GDRIVE_ROOT_FOLDER"] == "Lectures"

    def test_bool_is_written_as_a_readable_flag(self):
        settings.apply_config({"drive_enabled": True})
        assert os.environ["DRIVE_ENABLED"] == "true"
        assert settings.drive_enabled() is True

    def test_none_and_unknown_fields_are_ignored(self, monkeypatch):
        monkeypatch.setenv("GEMINI_MODEL", "kept")
        assert settings.apply_config({"gemini_model": None, "nope": "x"}) == []
        assert settings.gemini_model() == "kept"
