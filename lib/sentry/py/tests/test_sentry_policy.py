import json

import pytest
import sentry_policy
from sentry_policy import enabled, options, scrub, scrub_breadcrumb, tags

GROQ = "gsk_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"
GEMINI = "AIza" + "SyD-abcdefghijklmnopqrstuvwxyz_0123"
LINUX_FILE = "/home/shalom/data/מבוא למדעי המחשב/הרצאה 3/audio.mp3"
WIN_FILE = r"C:\Users\שלום\AppData\Local\FastStudy\data\אלגוריתמים\Recitations\תרגול 2\summary.md"
WIN_ROOT = r"C:\Users\שלום\AppData\Local\FastStudy\data"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in (
        "DATA_ROOT",
        "GROQ_API_KEY",
        "GEMINI_API_KEY",
        "FASTSTUDY_SECRET",
        "FASTSTUDY_SENTRY_DSN",
        "FASTSTUDY_VERSION",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HOME", "/home/shalom")


def leaks(event):
    """Everything the scrubber must never let through, checked over the whole serialized event."""

    text = json.dumps(event, ensure_ascii=False)
    found = [s for s in ("shalom", "שלום", GROQ, GEMINI, "hunter2hunter2") if s in text]
    found += [c for c in text if "\u0590" <= c <= "\u05ff"][:1]
    return found


def full_event():
    return {
        "server_name": "SHALOM-LAPTOP",
        "user": {"ip_address": "10.0.0.2"},
        "message": f"failed on {LINUX_FILE} with key {GROQ}",
        "exception": {
            "values": [
                {
                    "type": "FileNotFoundError",
                    "value": f"[Errno 2] No such file: '{WIN_FILE}'",
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": "/home/shalom/fast_study/backend/pipeline.py",
                                "abs_path": "/home/shalom/fast_study/backend/pipeline.py",
                                "context_line": "    open('/home/shalom/data/קורס/x.mp3')",
                                "pre_context": ["course = 'אלגוריתמים'"],
                                "vars": {"key": f"'{GEMINI}'", "lecture": "'הרצאה 3'"},
                            }
                        ]
                    },
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {
                    "message": "GET /summary?secret=hunter2hunter2&c=%D7%A7%D7%95%D7%A8%D7%A1",
                    "data": {"k": GROQ},
                }
            ]
        },
        "extra": {"path": WIN_FILE, "keys": [GEMINI, GROQ]},
        "contexts": {
            "os": {"name": "Windows"},
            "app": {"cwd": r"C:\Users\shalom\fast_study"},
        },
        "request": {
            "url": "http://127.0.0.1:8001/lecture/%D7%94%D7%A8%D7%A6%D7%90%D7%94%203?secret=hunter2hunter2"
        },
    }


def test_full_event_leaks_nothing():
    """Paths, Hebrew, the home name and both keys are gone from every field the SDK fills."""

    out = scrub(full_event(), {})
    assert leaks(out) == []


def test_server_name_and_user_removed():
    """Sentry fills server_name with the hostname, which names the machine."""

    out = scrub(full_event(), {})
    assert "server_name" not in out
    assert "user" not in out


def test_data_root_swallows_the_whole_path(monkeypatch):
    """Under a Hebrew DATA_ROOT the path is one placeholder, trailing prose kept."""

    monkeypatch.setenv("DATA_ROOT", WIN_ROOT)
    out = scrub({"message": f"cannot open {WIN_FILE}: locked"}, None)
    assert out["message"] == "cannot open <data>: locked"


def test_data_root_matches_either_separator(monkeypatch):
    """The same root written with forward slashes or JSON-doubled backslashes still matches."""

    monkeypatch.setenv("DATA_ROOT", WIN_ROOT)
    forward = WIN_FILE.replace("\\", "/")
    doubled = WIN_FILE.replace("\\", "\\\\")
    out = scrub({"a": forward, "b": doubled}, None)
    assert out == {"a": "<data>", "b": "<data>"}


def test_non_hebrew_names_under_data_root_go_too(monkeypatch):
    """An English course name under DATA_ROOT is still user content."""

    monkeypatch.setenv("DATA_ROOT", "/home/shalom/data")
    out = scrub({"message": "open /home/shalom/data/Calculus 1/lec.mp3"}, None)
    assert out["message"] == "open <data>"


def test_hebrew_run_is_one_placeholder():
    """A multi-word Hebrew name collapses to one placeholder; digits beside it stay."""

    out = scrub({"message": "course מבוא למדעי המחשב lecture הרצאה 3"}, None)
    assert out["message"] == "course <hebrew> lecture <hebrew> 3"


def test_hebrew_escaped_forms():
    """Percent-encoded, \\u-escaped and presentation-form Hebrew are caught too."""

    out = scrub(
        {
            "a": "/x/%D7%A7%D7%95%D7%A8%D7%A1/y",
            "b": r"'\u05e7\u05d5\u05e8'",
            "c": "\ufb2a\ufb2b",
        },
        None,
    )
    assert out == {"a": "/x/<hebrew>/y", "b": "'<hebrew>'", "c": "<hebrew>"}


def test_generic_home_patterns_keep_prefix(monkeypatch):
    """With the real home unknown, each OS's profile folder keeps its prefix and loses the name."""

    monkeypatch.setenv("HOME", "/nonexistent-home-for-test")
    out = scrub(
        {
            "w": r"C:\Users\Bob\AppData\x.log",
            "f": "C:/Users/bob/x",
            "l": "/home/alice/x",
            "m": "/Users/carol",
            "s": r"C:\Users\John Smith\Desktop",
        },
        None,
    )
    assert out == {
        "w": r"C:\Users\<user>\AppData\x.log",
        "f": "C:/Users/<user>/x",
        "l": "/home/<user>/x",
        "m": "/Users/<user>",
        "s": r"C:\Users\<user>\Desktop",
    }


def test_actual_home_outside_standard_roots(monkeypatch):
    """A home in a non-standard location is still redacted, as a whole path component."""

    monkeypatch.setenv("HOME", "/srv/profiles/shalom")
    out = scrub({"a": "/srv/profiles/shalom/x", "b": "/srv/profiles/shalomX"}, None)
    assert out == {"a": "<home>/x", "b": "/srv/profiles/shalomX"}


def test_env_key_values_redacted(monkeypatch):
    """The literal key values are redacted even when they match no known key shape."""

    monkeypatch.setenv("GROQ_API_KEY", "custom-groq-value-123")
    monkeypatch.setenv("GEMINI_API_KEY", "custom-gemini-value-456")
    monkeypatch.setenv("FASTSTUDY_SECRET", "launch-secret-789")
    out = scrub(
        {
            "message": "k=custom-groq-value-123",
            "extra": {"g": "custom-gemini-value-456"},
            "request": {"headers": {"X-FastStudy-Secret": "launch-secret-789"}},
        },
        None,
    )
    assert out == {
        "message": "k=<key>",
        "extra": {"g": "<key>"},
        "request": {"headers": {"X-FastStudy-Secret": "<key>"}},
    }


def test_key_patterns_redacted():
    out = scrub({"message": f"{GROQ} and {GEMINI}"}, None)
    assert out["message"] == "<key> and <key>"


def test_breadcrumb_scrubbed():
    """before_breadcrumb applies the same rules to message and data."""

    crumb = {
        "message": f"read {LINUX_FILE}",
        "data": {"url": f"/x?secret=abcdef12&k={GROQ}"},
    }
    out = scrub_breadcrumb(crumb, {})
    assert leaks(out) == []
    assert out["data"]["url"] == "/x?secret=<key>&k=<key>"


def test_failure_drops_the_event(monkeypatch):
    """A scrubber that throws returns None, so an unscrubbed event is never sent."""

    def boom(_s):
        raise RuntimeError("boom")

    monkeypatch.setattr(sentry_policy, "_scrub_str", boom)
    assert scrub({"message": "x"}, None) is None
    assert scrub_breadcrumb({"message": "x"}, None) is None


def test_tags_known_services():
    for service in ("backend", "database", "server", "auto", "electron", "frontend"):
        t = tags(service)
        assert t["service"] == service
        assert t["platform"] in ("win32", "linux", "darwin")


def test_tags_unknown_service_raises():
    with pytest.raises(ValueError):
        tags("downloader")


def test_options_without_dsn_is_disabled():
    """Dev has no DSN, so the caller skips init — there is no fallback DSN."""

    opts = options("backend")
    assert opts["dsn"] is None
    assert enabled() is False
    assert opts["environment"] == "development"
    assert opts["release"] == "faststudy@unknown"


def test_options_leave_tracing_unset():
    """Absent, not 0.0: a zero rate still turns tracing and trace-header propagation on."""

    assert "traces_sample_rate" not in options("backend")


def test_options_with_dsn_packaged(monkeypatch):
    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2")
    monkeypatch.setenv("FASTSTUDY_VERSION", "1.4.0")
    monkeypatch.setenv("FASTSTUDY_SECRET", "launch-secret-789")
    opts = options("database")
    assert enabled() is True
    assert opts == {
        "dsn": "https://abc@o1.ingest.sentry.io/2",
        "release": "faststudy@1.4.0",
        "environment": "production",
        "sample_rate": 1.0,
        "send_default_pii": False,
        "before_send": scrub,
        "before_breadcrumb": scrub_breadcrumb,
    }


def test_options_explicit_overrides(monkeypatch):
    monkeypatch.setenv("FASTSTUDY_VERSION", "1.4.0")
    opts = options(
        "backend", dsn="https://x@y/1", version="2.0.0", environment="staging"
    )
    assert (opts["dsn"], opts["release"], opts["environment"]) == (
        "https://x@y/1",
        "faststudy@2.0.0",
        "staging",
    )


def test_options_unknown_service_raises():
    with pytest.raises(ValueError):
        options("nope")
