"""Settings store: .env merge fidelity, write-only keys, and the DATA_ROOT create/probe."""

import pytest
import settings
from fastapi.testclient import TestClient

EXISTING_ENV = """# keys
GROQ_API_KEY="gsk_old"
GEMINI_API_KEY="ai_old"

DATA_ROOT=/old/root
PORT=8001  # not a setting
export GEMINI_MODEL=gemini-2.5-flash  # the cheap one
DOWNLOADER_EXTENSION_ID=abcdef
"""


@pytest.fixture
def env_file(tmp_path, monkeypatch):
    """Point the store at a throwaway .env holding settings, unknown keys, comments and blanks."""

    path = tmp_path / ".env"
    path.write_text(EXISTING_ENV, encoding="utf-8")
    monkeypatch.setattr(settings, "ENV_PATH", path)
    return path


@pytest.fixture
def client(env_file):
    """TestClient over the app, with the settings store pointed at the throwaway .env."""

    import main

    return TestClient(main.app)


def test_merge_leaves_everything_unnamed_untouched(env_file, tmp_path):
    settings.write_settings({"gemini_model": "gemini-3.5-flash"})

    text = env_file.read_text(encoding="utf-8")
    assert "# keys" in text
    assert 'GROQ_API_KEY="gsk_old"' in text
    assert "PORT=8001  # not a setting" in text
    assert "DOWNLOADER_EXTENSION_ID=abcdef" in text
    assert "\n\nDATA_ROOT=/old/root" in text
    assert text.endswith("DOWNLOADER_EXTENSION_ID=abcdef\n")


def test_only_named_keys_change(env_file):
    settings.write_settings({"groq_api_key": "gsk_new"})

    lines = env_file.read_text(encoding="utf-8").splitlines()
    assert "GROQ_API_KEY='gsk_new'" in lines
    assert 'GEMINI_API_KEY="ai_old"' in lines
    assert "DATA_ROOT=/old/root" in lines


def test_rewrite_happens_in_place(env_file):
    settings.write_settings({"gdrive_root_folder": "Root"})
    settings.write_settings({"gdrive_root_folder": "Other"})

    text = env_file.read_text(encoding="utf-8")
    assert text.count("GDRIVE_ROOT_FOLDER") == 1
    assert "GDRIVE_ROOT_FOLDER='Other'" in text


def test_duplicate_key_lines_collapse_to_the_new_value():
    merged = settings.merge_env_text("A=1\nB=2\nA=3\n", {"A": "9"})

    assert merged == "A='9'\nB=2\n"


def test_appends_to_a_file_with_no_trailing_newline():
    merged = settings.merge_env_text("A=1", {"B": "2"})

    assert merged == "A=1\nB='2'\n"


def test_read_reports_keys_as_set_never_as_values(env_file):
    stored = settings.read_settings()

    assert stored["gemini_api_key_set"] is True
    assert stored["groq_api_key_set"] is True
    assert "gemini_api_key" not in stored
    assert "ai_old" not in str(stored)


def test_absent_keys_read_as_null(env_file):
    stored = settings.read_settings()

    assert stored["gdrive_root_folder"] is None
    assert stored["ui_language"] is None
    assert stored["drive_enabled"] is None


def test_booleans_round_trip(env_file):
    stored = settings.write_settings(
        {"drive_enabled": True, "runner_controls_visible": False}
    )

    assert stored["drive_enabled"] is True
    assert stored["runner_controls_visible"] is False
    assert "DRIVE_ENABLED='true'" in env_file.read_text(encoding="utf-8")


def test_export_prefix_and_trailing_comment_survive_a_rewrite(env_file):
    settings.write_settings({"gemini_model": "gemini-3.5-flash"})

    lines = env_file.read_text(encoding="utf-8").splitlines()
    assert "export GEMINI_MODEL='gemini-3.5-flash'  # the cheap one" in lines


def test_an_exported_key_reads_back_after_a_rewrite(env_file):
    settings.write_settings({"gemini_model": "gemini-3.5-flash"})

    assert settings.read_settings()["gemini_model"] == "gemini-3.5-flash"


def test_a_comment_after_a_quoted_value_survives():
    merged = settings.merge_env_text("A='one'  # why\n", {"A": "two"})

    assert merged == "A='two'  # why\n"


def test_a_hash_inside_an_unquoted_value_is_not_a_comment():
    merged = settings.merge_env_text("A=one#two\n", {"A": "three"})

    assert merged == "A='three'\n"


def test_a_string_boolean_is_rejected_rather_than_read_as_truthy(env_file):
    with pytest.raises(ValueError):
        settings.write_settings({"drive_enabled": "false"})

    assert "DRIVE_ENABLED" not in env_file.read_text(encoding="utf-8")


def test_put_rejects_a_string_boolean(client, env_file):
    r = client.put("/settings", json={"drive_enabled": "false"})

    assert r.status_code == 400
    assert settings.read_settings()["drive_enabled"] is None


def test_null_leaves_a_stored_value_alone(env_file):
    stored = settings.write_settings({"gemini_api_key": None, "data_root": None})

    assert stored["gemini_api_key_set"] is True
    assert "DATA_ROOT=/old/root" in env_file.read_text(encoding="utf-8")


def test_unknown_setting_is_rejected(env_file):
    with pytest.raises(ValueError):
        settings.write_settings({"whisper_model": "large"})


def test_bad_ui_language_is_rejected(env_file):
    with pytest.raises(ValueError):
        settings.write_settings({"ui_language": "fr"})


def test_data_root_is_created_and_probed(env_file, tmp_path):
    target = tmp_path / "made" / "here"

    stored = settings.write_settings({"data_root": str(target)})

    assert stored["data_root"] == str(target)
    assert target.is_dir()
    assert list(target.iterdir()) == []


def test_unwritable_data_root_is_rejected(env_file, tmp_path):
    blocker = tmp_path / "afile"
    blocker.write_text("x", encoding="utf-8")

    with pytest.raises(ValueError):
        settings.write_settings({"data_root": str(blocker)})

    assert "DATA_ROOT=/old/root" in env_file.read_text(encoding="utf-8")


def test_relative_data_root_is_rejected(env_file):
    with pytest.raises(ValueError):
        settings.write_settings({"data_root": "relative/data"})


def test_get_and_put_over_http(client, env_file, tmp_path):
    body = client.get("/settings").json()
    assert body["groq_api_key_set"] is True
    assert body["runner_controls_visible"] is None

    target = tmp_path / "http-root"
    r = client.put(
        "/settings",
        json={
            "groq_api_key": "gsk_http",
            "data_root": str(target),
            "ui_language": "he",
        },
    )

    assert r.status_code == 200
    assert r.json()["ui_language"] == "he"
    assert r.json()["data_root"] == str(target)
    assert "gsk_http" not in r.text
    assert "GROQ_API_KEY='gsk_http'" in env_file.read_text(encoding="utf-8")


def test_put_rejects_a_bad_data_root(client, env_file):
    r = client.put("/settings", json={"data_root": "nope"})

    assert r.status_code == 400
    assert "error" in r.json()


def test_config_applies_data_root_without_restart(client, tmp_path):
    from fs.paths import data_root

    target = tmp_path / "live-root"
    r = client.post("/config", json={"data_root": str(target)})

    assert r.status_code == 204
    assert data_root() == target
    assert target.is_dir()


def test_config_rejects_an_unusable_data_root(client, tmp_path):
    from fs.paths import data_root

    before = data_root()
    r = client.post("/config", json={"data_root": "still-relative"})

    assert r.status_code == 400
    assert data_root() == before
