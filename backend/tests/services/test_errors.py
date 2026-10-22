"""A step failure caused by the frozen bundle's own executable becoming unreadable (an antivirus
quarantining it mid-run) is `app_files_blocked` with no params, whatever code it would carry."""

import logging
import sys

import pytest
from pipeline import runner
from services.errors import CodedError, app_files_blocked, error_fields

EXE = sys.executable


def _blocked(filename: str = EXE) -> OSError:
    return OSError(22, "Invalid argument", filename)


def _audio_failure(cause: BaseException) -> CodedError:
    """The audio step's wrapper, as strip_audio raises it."""

    try:
        raise cause
    except Exception as e:
        try:
            raise CodedError(str(e), "audio_extraction_failed", detail=str(e)) from e
        except CodedError as wrapped:
            return wrapped


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)


def test_frozen_oserror_on_own_executable_is_app_files_blocked(frozen):
    assert error_fields(_blocked(), "internal_error") == ("app_files_blocked", {})


def test_it_overrides_a_coded_wrapper_whose_cause_names_the_executable(frozen):
    assert error_fields(_audio_failure(_blocked()), "internal_error") == (
        "app_files_blocked",
        {},
    )


def test_it_is_found_through_an_implicit_context(frozen):
    try:
        try:
            raise _blocked()
        except OSError:
            raise ValueError("while importing")  # noqa: B904 -- the implicit __context__ is under test
    except ValueError as e:
        assert app_files_blocked(e)


def test_the_step_result_carries_the_code_and_no_detail(frozen):
    result = runner._failed(_audio_failure(_blocked()))
    assert (result["code"], result["params"]) == ("app_files_blocked", {})


def test_the_raw_error_is_still_logged_with_its_exception(frozen, caplog):
    with caplog.at_level(logging.WARNING, logger="errors"):
        error_fields(_audio_failure(_blocked()), "internal_error")
    (record,) = caplog.records
    assert "Invalid argument" in record.getMessage()
    assert record.exc_info is not None


def test_not_frozen_keeps_the_wrapper_code(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    wrapped = _audio_failure(_blocked())
    assert error_fields(wrapped, "internal_error") == (
        "audio_extraction_failed",
        {"detail": str(_blocked())},
    )
    assert error_fields(_blocked(), "internal_error")[0] == "internal_error"


def test_another_file_keeps_the_wrapper_code(frozen, tmp_path):
    wrapped = _audio_failure(_blocked(str(tmp_path / "video.mp4")))
    assert error_fields(wrapped, "internal_error")[0] == "audio_extraction_failed"
    assert runner._failed(wrapped)["code"] == "audio_extraction_failed"


def test_an_uncoded_unrelated_step_failure_still_names_no_code(frozen):
    assert "code" not in runner._failed(ValueError("boom"))
