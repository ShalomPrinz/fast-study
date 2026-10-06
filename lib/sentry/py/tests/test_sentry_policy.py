import importlib
import json
import time
from datetime import datetime, timezone

import pytest
import sentry_policy
from sentry_policy import (
    SHUTDOWN_TIMEOUT_S,
    enabled,
    options,
    scrub,
    scrub_breadcrumb,
    tags,
)

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
        "SENTRY_ENVIRONMENT",
        "FASTSTUDY_ERROR_REPORTS",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HOME", "/home/shalom")
    # The scrubbing tests run with reports on; the gate tests below set their own state.
    sentry_policy.set_reporting(True)


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
            "a": "x/%D7%A7%D7%95%D7%A8%D7%A1/y",
            "b": r"'\u05e7\u05d5\u05e8'",
            "c": "\ufb2a\ufb2b",
        },
        None,
    )
    assert out == {"a": "x/<hebrew>/y", "b": "'<hebrew>'", "c": "<hebrew>"}


def frame_paths(*paths):
    """An event whose one exception frame names each path in turn as its abs_path."""

    frames = [{"abs_path": p, "filename": p} for p in paths]
    return {"exception": {"values": [{"stacktrace": {"frames": frames}}]}}


def abs_paths(event):
    return [
        f["abs_path"] for f in event["exception"]["values"][0]["stacktrace"]["frames"]
    ]


def test_generic_home_patterns_keep_prefix(monkeypatch):
    """In frame paths, with the real home unknown, a profile folder keeps its prefix, loses the name."""

    monkeypatch.setenv("HOME", "/nonexistent-home-for-test")
    out = scrub(
        frame_paths(
            r"C:\Users\Bob\AppData\x.js",
            "C:/Users/bob/x.js",
            "/home/alice/x.py",
            "/Users/carol",
            r"C:\Users\John Smith\Desktop\x.js",
        ),
        None,
    )
    assert abs_paths(out) == [
        r"C:\Users\<user>\AppData\x.js",
        "C:/Users/<user>/x.js",
        "/home/<user>/x.py",
        "/Users/<user>",
        r"C:\Users\<user>\Desktop\x.js",
    ]


def test_actual_home_outside_standard_roots(monkeypatch):
    """In frame paths, a non-standard home is redacted as a whole path component."""

    monkeypatch.setenv("HOME", "/srv/profiles/shalom")
    out = scrub(
        frame_paths("/srv/profiles/shalom/x.py", "/srv/profiles/shalomX/y.py"), None
    )
    assert abs_paths(out) == ["<home>/x.py", "/srv/profiles/shalomX/y.py"]


def test_frame_paths_keep_their_folders(monkeypatch):
    """Our own code's frame paths stay readable; home, DATA_ROOT and Hebrew rules still apply."""

    monkeypatch.setenv("DATA_ROOT", "/mnt/data")
    out = scrub(
        frame_paths(
            "/opt/FastStudy/resources/backend/pipeline.py",
            "app://bundle/assets/index-abc.js",
            "/home/shalom/fast_study/backend/קוד/x.py",
            "/mnt/data/Calculus/x.py",
        ),
        None,
    )
    assert abs_paths(out) == [
        "/opt/FastStudy/resources/backend/pipeline.py",
        "app://bundle/assets/index-abc.js",
        "<home>/fast_study/backend/<hebrew>/x.py",
        "<data>",
    ]


def test_frame_vars_and_context_lose_folders():
    """Only a frame's own path fields keep folders; its vars and source lines are free text."""

    frame = {
        "abs_path": "/opt/app/x.py",
        "context_line": "open('/mnt/data/Calculus/week 2/notes.pdf')",
        "vars": {
            "path": "'/mnt/data/Calculus/week 2/notes.pdf'",
            "filename": "/mnt/a/b.pdf",
        },
    }
    out = scrub({"exception": {"values": [{"stacktrace": {"frames": [frame]}}]}}, None)
    got = out["exception"]["values"][0]["stacktrace"]["frames"][0]
    assert got == {
        "abs_path": "/opt/app/x.py",
        "context_line": "open('<path>/notes.pdf')",
        "vars": {"path": "'<path>/notes.pdf'", "filename": "<path>/b.pdf"},
    }


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            r"cannot open D:\Lectures\Algebra\Lecture 3\audio.mp3: locked",
            "cannot open <path>/audio.mp3: locked",
        ),
        (
            json.dumps({"path": r"D:\Lectures\Algebra\Lecture 3\audio.mp3"}),
            '{"path": "<path>/audio.mp3"}',
        ),
        (
            "No such file: '/mnt/data/Calculus/week 2/notes.pdf'",
            "No such file: '<path>/notes.pdf'",
        ),
        (
            r"copy \\nas\share\Physics\Lab 1\notes.pdf done",
            "copy <path>/notes.pdf done",
        ),
        (
            "load file:///C:/Lectures/Algebra/Lecture%203/audio.mp3 failed",
            "load file://<path>/audio.mp3 failed",
        ),
        (r"D:\Lectures\Algebra\הרצאה 3.mp3", "<path>/<hebrew> 3.mp3"),
        (r"C:\Users\John Smith\Desktop\x.pdf", "<path>/x.pdf"),
    ],
)
def test_free_text_paths_keep_only_the_file_name(text, expected):
    """A runtime-changed data root is not DATA_ROOT here, so every absolute path loses its folders."""

    assert scrub({"message": text}, None)["message"] == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "GET http://127.0.0.1:1234/api/lectures/Algebra 500",
            "GET http://127.0.0.1:1234/api/lectures/Algebra 500",
        ),
        (
            "http://127.0.0.1:8001/lecture/%D7%A7%D7%95%D7%A8%D7%A1/x",
            "http://127.0.0.1:8001/lecture/<hebrew>/x",
        ),
        (
            "at app://bundle/assets/index-abc.js:1:9700",
            "at app://bundle/assets/index-abc.js:1:9700",
        ),
        ("GET /summary?c=x", "GET /summary?c=x"),
    ],
)
def test_urls_and_bare_files_are_kept(text, expected):
    """scheme:// URLs keep host and route (Hebrew still goes); a path with no folder is left alone."""

    assert scrub({"message": text}, None)["message"] == expected


def test_long_slash_run_scrubs_fast(monkeypatch):
    """No root pattern rescans a slash run from every offset, so 50,000 slashes stay linear."""

    monkeypatch.setenv("DATA_ROOT", "/mnt/data")
    start = time.monotonic()
    out = scrub({"message": "/" * 50_000 + "a"}, None)
    assert time.monotonic() - start < 1
    assert out["message"] == "/" * 50_000 + "a"


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


def test_options_pin_the_shutdown_flush():
    """The Sentry host may be down: an exit waits on it for a short, fixed bound and no longer."""

    assert SHUTDOWN_TIMEOUT_S == 2
    assert options("backend")["shutdown_timeout"] == SHUTDOWN_TIMEOUT_S


def test_options_with_dsn_packaged(monkeypatch):
    monkeypatch.setenv("FASTSTUDY_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2")
    monkeypatch.setenv("FASTSTUDY_VERSION", "1.4.0")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "production")
    opts = options("database")
    assert enabled() is True
    assert opts == {
        "dsn": "https://abc@o1.ingest.sentry.io/2",
        "release": "faststudy@1.4.0",
        "environment": "production",
        "sample_rate": 1.0,
        "send_default_pii": False,
        "send_client_reports": False,
        "shutdown_timeout": 2,
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


def test_environment_precedence(monkeypatch):
    """Explicit beats SENTRY_ENVIRONMENT beats development; the launch secret no longer decides it."""

    monkeypatch.setenv("FASTSTUDY_SECRET", "launch-secret-789")
    assert options("backend")["environment"] == "development"
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "production")
    assert options("backend")["environment"] == "production"
    assert options("backend", environment="staging")["environment"] == "staging"


def test_options_unknown_service_raises():
    with pytest.raises(ValueError):
        options("nope")


class FakeTransport:
    """Stands in for the SDK's HttpTransport: capture_envelope queues, _send_envelope sends."""

    def __init__(self):
        self.queued, self.sent = [], []

    def capture_envelope(self, envelope):
        self.queued.append(envelope)

    def drain(self):
        while self.queued:
            self._send_envelope(self.queued.pop(0))

    def _send_envelope(self, envelope):
        self.sent.append(envelope)


def capture(transport, *envelopes):
    for envelope in envelopes:
        transport.capture_envelope(envelope)
    transport.drain()


class Item:
    def __init__(self, type):
        self.type = type


class Envelope:
    """The shape of the SDK's Envelope that the gate reads: `headers`, `items`, each with a `type`."""

    def __init__(self, headers=None, items=None):
        self.headers, self.items = headers or {}, list(items or [])


def env(*types):
    return Envelope(items=[Item(t) for t in types])


def sent_types(transport):
    return [[item.type for item in e.items] for e in transport.sent]


@pytest.mark.parametrize("value", [None, "", "0", "true", "yes", "on"])
def test_reports_start_off_unless_env_is_1(monkeypatch, value):
    if value is not None:
        monkeypatch.setenv("FASTSTUDY_ERROR_REPORTS", value)
    assert importlib.reload(sentry_policy).reporting() is False
    monkeypatch.setenv("FASTSTUDY_ERROR_REPORTS", "1")
    assert importlib.reload(sentry_policy).reporting() is True


def test_off_at_start_sends_nothing(monkeypatch):
    importlib.reload(sentry_policy)
    transport = sentry_policy.gated(FakeTransport)()
    capture(transport, env("event"), env("transaction"))
    assert transport.sent == []


def test_on_sends_everything_but_sessions():
    transport = sentry_policy.gated(FakeTransport)()
    capture(transport, env("event", "attachment"), env("transaction"))
    assert sent_types(transport) == [["event", "attachment"], ["transaction"]]


def test_session_items_are_never_sent():
    transport = sentry_policy.gated(FakeTransport)()
    capture(transport, env("session"), env("sessions"), env("event", "session"))
    assert sent_types(transport) == [["event"]]
    transport._send_envelope(env("sessions"))
    assert sent_types(transport) == [["event"]]


def test_switching_off_drops_later_and_already_queued_envelopes():
    transport = sentry_policy.gated(FakeTransport)()
    capture(transport, env("event"))
    transport.capture_envelope(env("transaction"))
    sentry_policy.set_reporting(False)
    capture(transport, env("check_in"))
    assert sent_types(transport) == [["event"]]


def test_switching_back_on_resumes():
    transport = sentry_policy.gated(FakeTransport)()
    sentry_policy.set_reporting(False)
    capture(transport, env("transaction"))
    sentry_policy.set_reporting(True)
    capture(transport, env("event"))
    assert sent_types(transport) == [["event"]]


def test_event_captured_while_off_is_dropped_after_the_switch():
    sentry_policy.set_reporting(False)
    captured_off = datetime.now(timezone.utc)
    sentry_policy.set_reporting(True)
    assert scrub({"message": "boom", "timestamp": captured_off}) is None
    assert scrub({"message": "boom", "timestamp": captured_off.timestamp()}) is None
    later = {"message": "boom", "timestamp": time.time() + 1}
    assert scrub(later) == later


def test_gated_is_a_subclass_of_the_sdk_transport():
    cls = sentry_policy.gated(FakeTransport)
    assert issubclass(cls, FakeTransport) and cls.__name__ == "GatedFakeTransport"


def test_scrubbers_drop_everything_while_off():
    sentry_policy.set_reporting(False)
    assert scrub({"message": "boom"}) is None
    assert scrub_breadcrumb({"message": "crumb"}) is None
    sentry_policy.set_reporting(True)
    assert scrub({"message": "boom"}) == {"message": "boom"}
