import logging

from logging_setup import AccessFilter, AccessFormatter, setup_logging


def access_record(method, path, status):
    """Build a uvicorn-shaped access record: args is (client, method, path, http_version, status)."""

    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:52344", method, path, "1.1", status),
        None,
    )


def test_head_dropped():
    """HEAD existence probes never reach a handler."""

    assert AccessFilter().filter(access_record("HEAD", "/tree", 200)) is False


def test_options_dropped():
    """CORS preflights never reach a handler."""

    assert AccessFilter().filter(access_record("OPTIONS", "/tree", 200)) is False


def test_get_2xx_dropped():
    """A successful GET is routine frontend traffic and is suppressed."""

    assert AccessFilter().filter(access_record("GET", "/tree", 200)) is False


def test_get_404_kept():
    """A failing GET still matters, so it survives the filter."""

    assert AccessFilter().filter(access_record("GET", "/tree", 404)) is True


def test_post_2xx_kept():
    """Writes are always logged, successful or not."""

    assert AccessFilter().filter(access_record("POST", "/courses", 200)) is True


def test_format_shape():
    """Kept lines read `[api] POST /path → 200`."""

    formatted = AccessFormatter().format(access_record("POST", "/courses", 200))
    assert formatted == "[api] POST /courses → 200"


def test_unexpected_args_pass_through():
    """A record that isn't uvicorn-shaped is neither dropped nor allowed to raise."""

    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 0, "something else", None, None
    )
    assert AccessFilter().filter(record) is True
    assert AccessFormatter().format(record) == "something else"


def test_wrong_arity_args_pass_through():
    """A tuple of the wrong length is as unrecognizable as no tuple at all, and takes the same path."""

    # msg carries exactly three placeholders because the formatter's fallback is super().format(),
    # which interpolates `msg % args` — a mismatch there would raise instead of formatting.
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 0, "%s %s %s", ("a", "b", "c"), None
    )
    assert AccessFilter().filter(record) is True
    assert AccessFormatter().format(record) == "a b c"


def test_setup_wires_the_access_logger():
    """setup_logging() leaves uvicorn.access carrying both the filter and the formatter: the wiring
    is what a competing dictConfig silently undoes, and the classes alone cannot catch that."""

    setup_logging()
    access = logging.getLogger("uvicorn.access")
    assert any(isinstance(f, AccessFilter) for f in access.filters)
    assert [type(h.formatter) for h in access.handlers] == [AccessFormatter]
    # Without this the root handler prints uvicorn's raw line beside the reformatted one.
    assert access.propagate is False


def test_setup_is_idempotent():
    """Both services import their entry module once, but a re-run must not stack a second handler."""

    setup_logging()
    setup_logging()
    assert len(logging.getLogger("uvicorn.access").handlers) == 1
