"""Settings store: .env merge fidelity, write-only keys, and the DATA_ROOT create/probe."""

import os

import pytest
import settings
from dotenv import dotenv_values
from fastapi.testclient import TestClient

EXISTING_ENV = """# keys
GROQ_API_KEY="gsk_old"
GEMINI_API_KEY="ai_old"

DATA_ROOT=/old/root
PORT=8001  # not a setting
export GEMINI_MODEL=gemini-2.5-flash  # the cheap one
UNRELATED_KEY=abcdef
"""


def _rejected(patch: dict) -> tuple[str, dict]:
    """Write a settings patch that must be refused and return the (code, params) it refused with."""

    with pytest.raises(ValueError) as caught:
        settings.write_settings(patch)
    return caught.value.code, caught.value.params


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

    import database_main

    return TestClient(database_main.app)


def test_merge_leaves_everything_unnamed_untouched(env_file, tmp_path):
    settings.write_settings({"gemini_model": "gemini-3.5-flash"})

    text = env_file.read_text(encoding="utf-8")
    assert "# keys" in text
    assert 'GROQ_API_KEY="gsk_old"' in text
    assert "PORT=8001  # not a setting" in text
    assert "UNRELATED_KEY=abcdef" in text
    assert "\n\nDATA_ROOT=/old/root" in text
    assert text.endswith("UNRELATED_KEY=abcdef\n")


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
    assert stored["drive_enabled"] is None
    assert stored["gemini_auto_fallback"] is None


def test_booleans_round_trip(env_file):
    assert settings.write_settings({"drive_enabled": True})["drive_enabled"] is True
    assert "DRIVE_ENABLED='true'" in env_file.read_text(encoding="utf-8")

    assert settings.write_settings({"drive_enabled": False})["drive_enabled"] is False
    assert "DRIVE_ENABLED='false'" in env_file.read_text(encoding="utf-8")


def test_gemini_auto_fallback_round_trips(env_file):
    assert (
        settings.write_settings({"gemini_auto_fallback": True})["gemini_auto_fallback"]
        is True
    )
    assert "GEMINI_AUTO_FALLBACK='true'" in env_file.read_text(encoding="utf-8")

    assert (
        settings.write_settings({"gemini_auto_fallback": False})["gemini_auto_fallback"]
        is False
    )
    assert "GEMINI_AUTO_FALLBACK='false'" in env_file.read_text(encoding="utf-8")


def test_auto_retry_fields_round_trip_and_read_null_when_unset(env_file):
    stored = settings.read_settings()
    assert stored["auto_retry"] is None
    assert stored["auto_retry_count"] is None
    assert stored["auto_retry_minutes"] is None

    stored = settings.write_settings(
        {"auto_retry": False, "auto_retry_count": 5, "auto_retry_minutes": 30}
    )
    assert (stored["auto_retry"], stored["auto_retry_count"]) == (False, 5)
    assert stored["auto_retry_minutes"] == 30
    text = env_file.read_text(encoding="utf-8")
    assert "AUTO_RETRY='false'" in text
    assert "AUTO_RETRY_COUNT='5'" in text
    assert "AUTO_RETRY_MINUTES='30'" in text


def test_auto_retry_fields_are_type_checked(env_file):
    assert _rejected({"auto_retry": "true"})[0] == "setting_must_be_boolean"
    assert _rejected({"auto_retry_count": True})[0] == "setting_must_be_integer"
    assert _rejected({"auto_retry_minutes": "10"})[0] == "setting_must_be_integer"


@pytest.fixture
def int_field(monkeypatch):
    """Patch a throwaway integer field into the store, independent of the real ones."""

    monkeypatch.setitem(settings.INT_FIELDS, "some_count", "SOME_COUNT")
    return "some_count"


def test_an_unset_int_reads_as_null(env_file, int_field):
    assert settings.read_settings()[int_field] is None


def test_a_non_numeric_stored_int_reads_as_null(env_file, int_field):
    env_file.write_text("SOME_COUNT=many\n", encoding="utf-8")

    assert settings.read_settings()[int_field] is None


def test_integers_round_trip(env_file, int_field):
    assert settings.write_settings({int_field: 3})[int_field] == 3
    assert "SOME_COUNT='3'" in env_file.read_text(encoding="utf-8")


# `isinstance(True, int)` is True, so a bool must be refused rather than stored as 1.
def test_a_boolean_is_rejected_for_an_int_field(env_file, int_field):
    assert _rejected({int_field: True}) == (
        "setting_must_be_integer",
        {"field": int_field},
    )

    assert "SOME_COUNT" not in env_file.read_text(encoding="utf-8")


def test_a_non_int_is_rejected_for_an_int_field(env_file, int_field):
    assert _rejected({int_field: "3"}) == (
        "setting_must_be_integer",
        {"field": int_field},
    )

    assert "SOME_COUNT" not in env_file.read_text(encoding="utf-8")


# The store validates an integer, not a range — clamping is the owning service's job.
def test_an_out_of_range_int_is_stored_unchanged(env_file, int_field):
    assert settings.write_settings({int_field: 99})[int_field] == 99


@pytest.mark.parametrize("mode", ["off", "audio", "full"])
def test_each_auto_run_mode_is_accepted(env_file, mode):
    assert settings.write_settings({"auto_run": mode})["auto_run"] == mode


def test_auto_run_is_stored_trimmed_and_lowercased(env_file):
    assert settings.write_settings({"auto_run": "  Audio "})["auto_run"] == "audio"

    assert "AUTO_RUN='audio'" in env_file.read_text(encoding="utf-8")


# The backend runs an unknown mode as `full`, so a typo must fail loudly instead of being stored.
def test_an_unknown_auto_run_mode_is_rejected(env_file):
    assert _rejected({"auto_run": " Weekly "}) == (
        "setting_invalid_choice",
        {"field": "auto_run", "value": "weekly"},
    )

    assert "AUTO_RUN" not in env_file.read_text(encoding="utf-8")


@pytest.mark.parametrize("provider", ["claude", "chatgpt", "gemini"])
def test_each_ai_provider_is_accepted(env_file, provider):
    assert settings.write_settings({"ai_provider": provider})["ai_provider"] == provider


def test_ai_provider_is_stored_trimmed_and_lowercased(env_file):
    assert (
        settings.write_settings({"ai_provider": " Gemini "})["ai_provider"] == "gemini"
    )

    assert "AI_PROVIDER='gemini'" in env_file.read_text(encoding="utf-8")


def test_an_unknown_ai_provider_is_rejected(env_file):
    assert _rejected({"ai_provider": " Copilot "}) == (
        "setting_invalid_choice",
        {"field": "ai_provider", "value": "copilot"},
    )

    assert "AI_PROVIDER" not in env_file.read_text(encoding="utf-8")


def test_put_rejects_an_unknown_ai_provider(client, env_file):
    r = client.put("/settings", json={"ai_provider": "copilot"})

    assert r.status_code == 400
    assert r.json()["code"] == "setting_invalid_choice"
    assert r.json()["params"] == {"field": "ai_provider", "value": "copilot"}


# A hand-edited or stale value must read as unset, so the renderer falls back to its own default.
@pytest.mark.parametrize(
    "stored, expected", [(None, None), ("copilot", None), ("ChatGPT", "chatgpt")]
)
def test_ai_provider_reads_null_unless_a_known_provider(env_file, stored, expected):
    if stored is not None:
        env_file.write_text(f"AI_PROVIDER={stored}\n", encoding="utf-8")

    assert settings.read_settings()["ai_provider"] == expected


def test_put_then_get_round_trips_ai_provider(client):
    assert (
        client.put("/settings", json={"ai_provider": "gemini"}).json()["ai_provider"]
        == "gemini"
    )
    assert client.get("/settings").json()["ai_provider"] == "gemini"


def test_a_value_is_merged_into_env_quoted_like_every_other_value():
    merged = settings.merge_env_text("A=1\n", {"AUTO_RUN": "full"})

    assert merged == "A=1\nAUTO_RUN='full'\n"


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
    assert _rejected({"drive_enabled": "false"}) == (
        "setting_must_be_boolean",
        {"field": "drive_enabled"},
    )

    assert "DRIVE_ENABLED" not in env_file.read_text(encoding="utf-8")


def test_put_rejects_a_string_boolean(client, env_file):
    r = client.put("/settings", json={"drive_enabled": "false"})

    assert r.status_code == 400
    assert r.json()["code"] == "setting_must_be_boolean"
    assert r.json()["params"] == {"field": "drive_enabled"}
    assert settings.read_settings()["drive_enabled"] is None


def test_null_leaves_a_stored_value_alone(env_file):
    stored = settings.write_settings({"gemini_api_key": None, "data_root": None})

    assert stored["gemini_api_key_set"] is True
    assert "DATA_ROOT=/old/root" in env_file.read_text(encoding="utf-8")


def test_unknown_setting_is_rejected(env_file):
    assert _rejected({"whisper_model": "large"}) == (
        "unknown_setting",
        {"field": "whisper_model"},
    )


# The UI language and the runner-control toggle are the browser profile's own, never the store's.
def test_a_frontend_only_preference_is_rejected(env_file):
    for field in ("ui_language", "runner_controls_visible"):
        assert _rejected({field: "he"}) == ("unknown_setting", {"field": field})


def test_data_root_is_created_and_probed(env_file, tmp_path):
    target = tmp_path / "made" / "here"

    stored = settings.write_settings({"data_root": str(target)})

    assert stored["data_root"] == str(target)
    assert target.is_dir()
    assert list(target.iterdir()) == []


def test_unwritable_data_root_is_rejected(env_file, tmp_path):
    blocker = tmp_path / "afile"
    blocker.write_text("x", encoding="utf-8")

    assert _rejected({"data_root": str(blocker)}) == (
        "data_root_not_a_directory",
        {"path": str(blocker)},
    )

    assert "DATA_ROOT=/old/root" in env_file.read_text(encoding="utf-8")


def test_relative_data_root_is_rejected(env_file):
    assert _rejected({"data_root": "relative/data"}) == (
        "data_root_not_absolute",
        {"path": "relative/data"},
    )


def test_a_non_string_setting_is_rejected(env_file):
    assert _rejected({"gemini_model": 3}) == (
        "setting_must_be_string",
        {"field": "gemini_model"},
    )


def test_a_quoted_value_is_rejected(env_file):
    assert _rejected({"gdrive_root_folder": "it's"}) == (
        "setting_may_not_contain_quotes",
        {"field": "gdrive_root_folder"},
    )


def test_an_empty_data_root_is_rejected(env_file):
    assert _rejected({"data_root": "   "}) == ("data_root_empty", {})


def test_get_and_put_over_http(client, env_file, tmp_path):
    body = client.get("/settings").json()
    assert body["groq_api_key_set"] is True
    assert body["drive_enabled"] is None

    target = tmp_path / "http-root"
    r = client.put(
        "/settings",
        json={
            "groq_api_key": "gsk_http",
            "data_root": str(target),
            "drive_enabled": True,
        },
    )

    assert r.status_code == 200
    assert r.json()["drive_enabled"] is True
    assert r.json()["data_root"] == str(target)
    assert "gsk_http" not in r.text
    assert "GROQ_API_KEY='gsk_http'" in env_file.read_text(encoding="utf-8")


def test_put_rejects_a_bad_data_root(client, env_file):
    r = client.put("/settings", json={"data_root": "nope"})

    assert r.status_code == 400
    assert r.json()["code"] == "data_root_not_absolute"
    assert r.json()["params"] == {"path": "nope"}


def test_config_applies_data_root_without_restart(client, tmp_path):
    from fs.paths import data_root

    target = tmp_path / "live-root"
    r = client.post("/config", json={"data_root": str(target)})

    assert r.status_code == 204
    assert data_root() == target
    assert target.is_dir()


def test_config_publishes_the_root_to_the_environment(client, tmp_path, monkeypatch):
    monkeypatch.setenv(
        "DATA_ROOT", "placeholder"
    )  # so teardown restores the original env
    target = tmp_path / "קורסים"
    r = client.post("/config", json={"data_root": str(target)})

    assert r.status_code == 204
    assert os.environ["DATA_ROOT"] == str(target)


def test_config_rejects_an_unusable_data_root(client, tmp_path):
    from fs.paths import data_root

    before = data_root()
    r = client.post("/config", json={"data_root": "still-relative"})

    assert r.status_code == 400
    assert r.json()["code"] == "data_root_not_absolute"
    assert data_root() == before


@pytest.mark.parametrize("value", ["\\\\nas\\share", "C:\\x\\y", "a\\\\\\b"])
def test_backslashes_round_trip(env_file, value):
    # python-dotenv unescapes `\\` inside single quotes, so a UNC root would lose its leading slash.
    settings.write_settings({"gdrive_root_folder": value, "auto_run": "off"})

    assert settings.read_settings()["gdrive_root_folder"] == value


@pytest.mark.parametrize(
    ("value", "stored"),
    [
        ("C:\\data\\", "C:\\data"),
        ("C:\\data\\\\\\", "C:\\data"),
        ("\\\\server\\share\\", "\\\\server\\share"),
        ("C:\\", "C:\\"),
        ("d:\\\\", "d:\\"),
    ],
)
def test_trailing_backslashes_are_stripped_except_a_drive_root(env_file, value, stored):
    # A later quoted line is what made python-dotenv swallow a closing `\'`, so one follows the value.
    settings.write_settings({"gdrive_root_folder": value, "auto_run": "off"})

    assert settings.read_settings()["gdrive_root_folder"] == stored
    assert settings.read_settings()["auto_run"] == "off"


def test_a_drive_root_is_written_unquoted_and_read_literally(env_file):
    # The line after holds a `'` (a comment), the case where a quoted `'C:\\'` would be lost.
    env_file.write_text(
        "GDRIVE_ROOT_FOLDER=old # it's here\nAUTO_RUN='off'\n", encoding="utf-8"
    )
    settings.write_settings({"gdrive_root_folder": "C:\\"})

    assert (
        env_file.read_text(encoding="utf-8").splitlines()[0]
        == "GDRIVE_ROOT_FOLDER=C:\\ # it's here"
    )
    assert dotenv_values(env_file) == {"GDRIVE_ROOT_FOLDER": "C:\\", "AUTO_RUN": "off"}


def test_moodle_site_round_trips_to_its_env_key(env_file):
    settings.write_settings({"moodle_site": "https://x.ac.il/moodle"})

    assert dotenv_values(env_file)["MOODLE_SITE"] == "https://x.ac.il/moodle"
    assert settings.read_settings()["moodle_site"] == "https://x.ac.il/moodle"


def _probe(client, data_root) -> dict:
    """POST a candidate data root to the probe and return its 200 verdict body."""

    r = client.post("/settings/data-root/probe", json={"data_root": data_root})
    assert r.status_code == 200
    return r.json()


def test_probe_approves_a_missing_folder_under_a_writable_parent(client, tmp_path):
    target = tmp_path / "not" / "yet"
    before = sorted(tmp_path.iterdir())

    assert _probe(client, str(target)) == {"ok": True, "path": str(target)}
    assert sorted(tmp_path.iterdir()) == before


def test_probe_leaves_an_existing_folder_untouched(client, tmp_path):
    target = tmp_path / "root"
    target.mkdir()

    assert _probe(client, str(target))["ok"] is True
    assert list(target.iterdir()) == []


def test_probe_rejects_an_existing_file(client, tmp_path):
    blocker = tmp_path / "afile"
    blocker.write_text("x", encoding="utf-8")

    body = _probe(client, str(blocker))

    assert body["ok"] is False
    assert body["code"] == "data_root_not_a_directory"
    assert body["params"] == {"path": str(blocker)}
    assert body["error"]


def test_probe_rejects_a_folder_under_a_file(client, tmp_path):
    blocker = tmp_path / "afile"
    blocker.write_text("x", encoding="utf-8")

    body = _probe(client, str(blocker / "sub"))

    assert body["code"] == "data_root_not_writable"
    assert body["params"]["path"] == str(blocker / "sub")


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores permission bits")
@pytest.mark.parametrize("method,route", [("put", "/settings"), ("post", "/config")])
def test_a_root_under_an_untraversable_parent_is_not_writable(
    client, env_file, tmp_path, method, route
):
    # Python 3.12's exists() raises EACCES here, which must not surface as a settings-store failure.
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(0o000)
    try:
        r = getattr(client, method)(route, json={"data_root": str(locked / "sub")})
    finally:
        locked.chmod(0o700)

    assert r.status_code == 400
    assert r.json()["code"] == "data_root_not_writable"
    assert r.json()["params"]["path"] == str(locked / "sub")
    assert "Permission denied" in r.json()["params"]["detail"]


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores permission bits")
def test_probe_rejects_an_unwritable_parent(client, tmp_path):
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(0o500)
    try:
        body = _probe(client, str(locked / "sub"))
    finally:
        locked.chmod(0o700)

    assert body["code"] == "data_root_not_writable"
    assert not (locked / "sub").exists()


def test_probe_rejects_a_relative_path(client):
    assert _probe(client, "relative/data") == {
        "ok": False,
        "code": "data_root_not_absolute",
        "params": {"path": "relative/data"},
        "error": "data root must be an absolute path: relative/data",
    }


def test_probe_rejects_an_empty_path(client):
    body = _probe(client, "  ")

    assert (body["ok"], body["code"], body["params"]) == (False, "data_root_empty", {})


def test_probe_answers_400_on_a_body_without_data_root(client):
    r = client.post("/settings/data-root/probe", json={})

    assert r.status_code == 400
    assert r.json()["code"] == "bad_request_body"


@pytest.mark.parametrize(
    "field,env,choices",
    [
        ("auto_remove", "AUTO_REMOVE", ("off", "video", "audio")),
        ("auto_remove_after", "AUTO_REMOVE_AFTER", ("pdf", "drive")),
    ],
)
def test_auto_remove_fields_store_each_choice_lowercased(env_file, field, env, choices):
    for choice in choices:
        assert settings.write_settings({field: f" {choice.upper()} "})[field] == choice
    assert f"{env}='{choices[-1]}'" in env_file.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "field,bad",
    [("auto_remove", "transcript"), ("auto_remove_after", "never")],
)
def test_auto_remove_fields_refuse_an_unknown_choice(env_file, field, bad):
    assert _rejected({field: bad}) == (
        "setting_invalid_choice",
        {"field": field, "value": bad},
    )


def test_auto_remove_fields_read_null_when_unset(env_file):
    stored = settings.read_settings()
    assert stored["auto_remove"] is None
    assert stored["auto_remove_after"] is None


@pytest.mark.parametrize("mode", ["split", "lectures_all", "lectures_some"])
def test_each_course_structure_is_accepted(env_file, mode):
    assert (
        settings.write_settings({"course_structure": mode})["course_structure"] == mode
    )


def test_put_rejects_an_unknown_course_structure(client, env_file):
    r = client.put("/settings", json={"course_structure": "sideways"})
    assert r.status_code == 400
    assert r.json()["code"] == "setting_invalid_choice"
    assert r.json()["params"] == {"field": "course_structure", "value": "sideways"}


@pytest.mark.parametrize(
    "stored,expected", [(None, None), ("bogus", None), ("Lectures_All", "lectures_all")]
)
def test_course_structure_reads_null_unless_a_known_mode(env_file, stored, expected):
    if stored is not None:
        env_file.write_text(f"COURSE_STRUCTURE={stored}\n", encoding="utf-8")
    assert settings.read_settings()["course_structure"] == expected


def test_a_string_is_rejected_for_gemini_auto_fallback(env_file):
    assert _rejected({"gemini_auto_fallback": "true"}) == (
        "setting_must_be_boolean",
        {"field": "gemini_auto_fallback"},
    )

    assert "GEMINI_AUTO_FALLBACK" not in env_file.read_text(encoding="utf-8")
