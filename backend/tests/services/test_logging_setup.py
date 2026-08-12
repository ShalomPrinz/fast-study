import logging

from services.logging_setup import AccessFilter, AccessFormatter


def make_record(args):
    """A uvicorn.access-shaped record; uvicorn passes its fields via record.args."""

    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        args,
        None,
    )


class TestAccessFilter:
    def test_head_dropped(self):
        record = make_record(("127.0.0.1:1", "HEAD", "/courses", "1.1", 200))
        assert AccessFilter().filter(record) is False

    def test_options_dropped(self):
        record = make_record(("127.0.0.1:1", "OPTIONS", "/courses", "1.1", 200))
        assert AccessFilter().filter(record) is False

    def test_successful_get_dropped(self):
        record = make_record(("127.0.0.1:1", "GET", "/status", "1.1", 200))
        assert AccessFilter().filter(record) is False

    def test_failed_get_kept(self):
        record = make_record(("127.0.0.1:1", "GET", "/nope", "1.1", 404))
        assert AccessFilter().filter(record) is True

    def test_post_kept(self):
        record = make_record(("127.0.0.1:1", "POST", "/timing", "1.1", 200))
        assert AccessFilter().filter(record) is True

    def test_unexpected_args_pass_through(self):
        record = make_record(("just", "three", "items"))
        assert AccessFilter().filter(record) is True


class TestAccessFormatter:
    def test_kept_record_format(self):
        record = make_record(("127.0.0.1:1", "POST", "/path", "1.1", 200))
        assert AccessFormatter().format(record) == "[api] POST /path → 200"

    def test_unexpected_args_use_base_formatter(self):
        record = logging.LogRecord(
            "runner", logging.INFO, __file__, 0, "plain message", None, None
        )
        assert AccessFormatter().format(record) == "plain message"
