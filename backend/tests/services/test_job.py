import logging
from unittest.mock import MagicMock

import pytest
from services import job


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(job, "_job", None)
    monkeypatch.setattr(job.ctypes, "get_last_error", lambda: 5, raising=False)


def _k32(monkeypatch, **returns):
    k32 = MagicMock()
    k32.CreateJobObjectW.return_value = returns.get("create", 1234)
    k32.SetInformationJobObject.return_value = returns.get("set", 1)
    k32.AssignProcessToJobObject.return_value = returns.get("assign", 1)
    win = MagicMock(return_value=k32)
    monkeypatch.setattr(job.ctypes, "WinDLL", win, raising=False)
    return k32, win


def test_noop_off_windows(monkeypatch):
    _, win = _k32(monkeypatch)
    monkeypatch.setattr(job.sys, "platform", "linux")
    job.join_kill_on_close_job()
    win.assert_not_called()
    assert job._job is None


@pytest.mark.parametrize("failing", ["create", "set", "assign"])
def test_failure_logs_and_does_not_raise(monkeypatch, caplog, failing):
    _k32(monkeypatch, **{failing: 0})
    monkeypatch.setattr(job.sys, "platform", "win32")
    with caplog.at_level(logging.ERROR, logger="job"):
        job.join_kill_on_close_job()
    assert "error 5" in caplog.text
    assert job._job is None


def test_success_keeps_handle_and_kill_on_close_and_breakaway_ok(monkeypatch):
    k32, _ = _k32(monkeypatch)
    monkeypatch.setattr(job.sys, "platform", "win32")
    job.join_kill_on_close_job()
    assert job._job == 1234
    info = k32.SetInformationJobObject.call_args.args[2]._obj
    assert info.BasicLimitInformation.LimitFlags == 0x2000 | 0x800
    assert k32.SetInformationJobObject.call_args.args[1] == 9
    k32.CloseHandle.assert_not_called()


def test_struct_size_matches_win64():
    import ctypes

    if ctypes.sizeof(ctypes.c_size_t) == 8:
        assert ctypes.sizeof(job._ExtendedLimits) == 144
