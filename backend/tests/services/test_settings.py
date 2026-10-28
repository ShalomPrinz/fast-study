import os

import pytest
from services import settings


class TestGeminiModel:
    def test_falls_back_to_the_curated_default(self, monkeypatch):
        monkeypatch.delenv("GEMINI_MODEL", raising=False)
        assert settings.gemini_model() == settings.GEMINI_MODELS[0]

    def test_a_listed_model_is_kept(self, monkeypatch):
        monkeypatch.setenv("GEMINI_MODEL", "gemini-3.6-flash")
        assert settings.gemini_model() == "gemini-3.6-flash"

    def test_an_unlisted_model_falls_back(self, monkeypatch):
        monkeypatch.setenv("GEMINI_MODEL", "gemini-3.5-flash")
        assert settings.gemini_model() == settings.GEMINI_MODELS[0]

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


class TestNightlyRun:
    def test_unset_is_on(self, monkeypatch):
        monkeypatch.delenv("NIGHTLY_RUN", raising=False)
        assert settings.nightly_run() is True

    @pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", " on "])
    def test_truthy_values(self, monkeypatch, value):
        monkeypatch.setenv("NIGHTLY_RUN", value)
        assert settings.nightly_run() is True

    @pytest.mark.parametrize("value", ["false", "0", "off", "", "maybe"])
    def test_everything_else_is_off(self, monkeypatch, value):
        monkeypatch.setenv("NIGHTLY_RUN", value)
        assert settings.nightly_run() is False


class TestNightlyHour:
    def test_unset_is_the_default(self, monkeypatch):
        monkeypatch.delenv("NIGHTLY_HOUR", raising=False)
        assert settings.nightly_hour() == settings.DEFAULT_NIGHTLY_HOUR

    @pytest.mark.parametrize("value,expected", [("0", 0), ("7", 7), (" 23 ", 23)])
    def test_a_valid_hour_wins(self, monkeypatch, value, expected):
        monkeypatch.setenv("NIGHTLY_HOUR", value)
        assert settings.nightly_hour() == expected

    @pytest.mark.parametrize("value", ["24", "-1", "99"])
    def test_out_of_range_falls_back(self, monkeypatch, value):
        monkeypatch.setenv("NIGHTLY_HOUR", value)
        assert settings.nightly_hour() == settings.DEFAULT_NIGHTLY_HOUR

    @pytest.mark.parametrize("value", ["", "three", "3.5"])
    def test_non_numeric_falls_back(self, monkeypatch, value):
        monkeypatch.setenv("NIGHTLY_HOUR", value)
        assert settings.nightly_hour() == settings.DEFAULT_NIGHTLY_HOUR


class TestApplyConfig:
    # setenv first so monkeypatch restores what apply_config writes straight into os.environ.
    @pytest.fixture(autouse=True)
    def _isolate_env(self, monkeypatch):
        for var in (
            "GEMINI_API_KEY",
            "GEMINI_MODEL",
            "DRIVE_ENABLED",
            "GDRIVE_ROOT_FOLDER",
            "NIGHTLY_RUN",
            "NIGHTLY_HOUR",
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

    def test_writes_the_nightly_pair(self):
        applied = settings.apply_config({"nightly_run": False, "nightly_hour": 21})
        assert sorted(applied) == ["nightly_hour", "nightly_run"]
        assert settings.nightly_run() is False
        assert settings.nightly_hour() == 21

    def test_none_and_unknown_fields_are_ignored(self, monkeypatch):
        monkeypatch.setenv("GEMINI_MODEL", "gemini-3.6-flash")
        assert settings.apply_config({"gemini_model": None, "nope": "x"}) == []
        assert settings.gemini_model() == "gemini-3.6-flash"


class TestAutoRemove:
    def test_unset_is_off(self, monkeypatch):
        monkeypatch.delenv("AUTO_REMOVE", raising=False)
        assert settings.auto_remove() == "off"

    @pytest.mark.parametrize("value", ["off", "video", " AUDIO "])
    def test_listed_values_are_kept(self, monkeypatch, value):
        monkeypatch.setenv("AUTO_REMOVE", value)
        assert settings.auto_remove() == value.strip().lower()

    def test_an_unknown_value_removes_nothing(self, monkeypatch):
        monkeypatch.setenv("AUTO_REMOVE", "everything")
        assert settings.auto_remove() == "off"


class TestAutoRemoveAfter:
    @pytest.mark.parametrize("value", ["", "never", "summary"])
    def test_unset_or_unknown_is_none(self, monkeypatch, value):
        monkeypatch.setenv("AUTO_REMOVE_AFTER", value)
        assert settings.auto_remove_after() is None

    @pytest.mark.parametrize("value", ["pdf", "Drive"])
    def test_listed_values_are_kept(self, monkeypatch, value):
        monkeypatch.setenv("AUTO_REMOVE_AFTER", value)
        assert settings.auto_remove_after() == value.lower()


def test_gemini_auto_fallback_defaults_off_and_reads_at_call_time(monkeypatch):
    monkeypatch.delenv("GEMINI_AUTO_FALLBACK", raising=False)
    assert settings.gemini_auto_fallback() is False
    monkeypatch.setenv("GEMINI_AUTO_FALLBACK", "true")
    assert settings.gemini_auto_fallback() is True
