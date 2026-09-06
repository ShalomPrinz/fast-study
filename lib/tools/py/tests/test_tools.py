import os
import stat
from pathlib import Path

import pytest
from tools import check_tools, tool_path


@pytest.fixture
def bin_dir(tmp_path, monkeypatch):
    """A FASTSTUDY_BIN_DIR pointing at an empty temp directory."""

    monkeypatch.setenv("FASTSTUDY_BIN_DIR", str(tmp_path))
    return tmp_path


def write_tool(name: str, exit_code: int) -> Path:
    """Drop an executable at whatever path `tool_path` resolves `name` to, so the test never has
    to know the platform's exe suffix."""

    path = Path(tool_path(name))
    path.write_text(f"#!/bin/sh\nexit {exit_code}\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


def test_unset_bin_dir_leaves_the_bare_name(monkeypatch):
    monkeypatch.delenv("FASTSTUDY_BIN_DIR", raising=False)
    assert tool_path("ffmpeg") == "ffmpeg"


def test_set_bin_dir_gives_an_absolute_path(bin_dir):
    resolved = Path(tool_path("ffmpeg"))
    assert resolved.is_absolute()
    assert resolved.parent == bin_dir
    assert resolved.stem == "ffmpeg"


def test_exe_suffix_matches_the_platform(bin_dir):
    expected = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    assert Path(tool_path("ffmpeg")).name == expected


def test_curl_stays_on_path_even_when_bundled(bin_dir):
    # Windows 10+ ships curl.exe, so it is deliberately not in resources/bin/.
    assert tool_path("curl") == "curl"


def test_a_working_tool_reports_ok(bin_dir):
    write_tool("faketool", 0)
    assert check_tools(["faketool"]) == {"faketool": "ok"}


def test_an_absent_tool_reports_missing(bin_dir):
    assert check_tools(["faketool"]) == {"faketool": "missing"}


def test_a_failing_tool_reports_its_exit_code(bin_dir):
    write_tool("faketool", 3)
    assert check_tools(["faketool"]) == {"faketool": "exited 3"}


def test_every_name_is_reported(bin_dir):
    write_tool("good", 0)
    assert check_tools(["good", "bad"]) == {"good": "ok", "bad": "missing"}
