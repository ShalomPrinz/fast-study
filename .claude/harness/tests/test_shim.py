"""The Python shim's lock and platform patches. It swaps process-wide builtins, so each case runs
it in a child whose stub `fs.paths` / `fs.crud` fire its real import hook, never in pytest itself."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SHIM = Path(__file__).resolve().parent.parent / "shim"
BUSY = "The process cannot access the file because it is being used by another process"

# Runs in the child: `attempt` reports an operation's outcome as JSON-friendly data.
PRELUDE = """
import json, os, sys
import fs.paths

def attempt(fn, *args):
    try:
        result = fn(*args)
        if hasattr(result, "close"):
            result.close()
        return {"ok": True}
    except PermissionError as error:
        return {"winerror": getattr(error, "winerror", None), "str": str(error)}
"""


@pytest.fixture
def child(tmp_path):
    """Run `code` after the prelude in a child with the shim live, returning its printed JSON."""

    stubs = tmp_path / "stubs" / "fs"
    stubs.mkdir(parents=True)
    (stubs / "__init__.py").write_text("")
    (stubs / "paths.py").write_text("")
    (stubs / "crud.py").write_text("import sys\n")

    def run(code, *, locks=None, harness=True):
        if locks is not None:
            text = locks if isinstance(locks, str) else json.dumps(locks)
            (tmp_path / "locks.json").write_text(text)
        env = {k: v for k, v in os.environ.items() if not k.startswith("HARNESS_")}
        env["PYTHONPATH"] = os.pathsep.join([str(SHIM), str(tmp_path / "stubs")])
        if harness:
            env["HARNESS_DIR"] = str(tmp_path)
            env["HARNESS_PROVIDERS"] = "http://127.0.0.1:1"
        done = subprocess.run(
            [sys.executable, "-c", PRELUDE + code],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert done.returncode == 0, done.stderr
        return json.loads(done.stdout)

    return run


@pytest.fixture
def summary(tmp_path):
    """A lecture file under a DATA_ROOT-shaped tree."""

    path = tmp_path / "data" / "course" / "lecture" / "summary.pdf"
    path.parent.mkdir(parents=True)
    path.write_text("pdf")
    return path


def write_attempt(path):
    return f"print(json.dumps(attempt(open, {str(path)!r}, 'a')))"


def test_inert_without_harness_dir(child, summary):
    code = (
        "import socket\n"
        "print(json.dumps([socket.getaddrinfo.__name__, "
        f"attempt(open, {str(summary)!r}, 'w')]))"
    )
    assert child(code, locks=["summary.pdf"], harness=False) == [
        "getaddrinfo",
        {"ok": True},
    ]


def test_live_with_harness_dir(child):
    code = "import socket\nprint(json.dumps(socket.getaddrinfo.__name__))"
    assert child(code) == "_guarded_getaddrinfo"


@pytest.mark.parametrize(
    "glob, locked",
    [
        ("summary.pdf", True),
        ("*.pdf", True),
        ("course/lecture/summary.pdf", True),
        ("lecture/*", True),
        ("ummary.pdf", False),
        ("other/lecture/summary.pdf", False),
        ("lecture/transcript.txt", False),
    ],
)
def test_glob_is_a_tail_match(child, summary, glob, locked):
    result = child(write_attempt(summary), locks=[glob])
    assert (result != {"ok": True}) is locked


@pytest.mark.parametrize("mode", ["w", "wb", "a", "ab", "x", "r+", "w+"])
def test_write_modes_are_a_sharing_violation(child, summary, mode):
    code = f"print(json.dumps(attempt(open, {str(summary)!r}, {mode!r})))"
    assert child(code, locks=["summary.pdf"]) == {
        "winerror": 32,
        "str": f"[WinError 32] {BUSY}: {str(summary)!r}",
    }


def test_reads_pass(child, summary):
    code = (
        f"p = {str(summary)!r}\n"
        "import io\n"
        "print(json.dumps([attempt(open, p), attempt(open, p, 'rb'), attempt(io.open, p)]))"
    )
    assert child(code, locks=["summary.pdf"]) == [{"ok": True}] * 3
    assert summary.read_text() == "pdf"


def test_unlink_and_rename_of_a_locked_file_refused(child, summary):
    other = summary.with_name("other.pdf")
    other.write_text("x")
    code = (
        f"p, q = {str(summary)!r}, {str(other)!r}\n"
        "print(json.dumps([attempt(os.unlink, p), attempt(os.remove, p), "
        "attempt(os.rename, p, q + '.new'), attempt(os.replace, q, p)]))"
    )
    results = child(code, locks=["summary.pdf"])
    assert [r["winerror"] for r in results] == [32, 32, 32, 32]
    assert all(r["str"].endswith(f": {str(summary)!r}") for r in results)
    assert summary.exists() and other.exists()


def test_directory_rename_with_a_locked_descendant(child, summary):
    lecture = summary.parent
    target = lecture.with_name("renamed")
    code = f"print(json.dumps(attempt(os.rename, {str(lecture)!r}, {str(target)!r})))"
    assert child(code, locks=["summary.pdf"]) == {
        "winerror": 5,
        "str": f"[WinError 5] Access is denied: {str(lecture)!r} -> {str(target)!r}",
    }
    course = lecture.parent
    code = f"print(json.dumps(attempt(os.replace, {str(course)!r}, {str(course) + '2'!r})))"
    assert child(code, locks=["summary.pdf"])["winerror"] == 5
    assert summary.exists()


def test_lock_on_a_missing_file_refuses_its_write_but_not_its_folder_rename(
    child, summary
):
    # Windows only refuses the folder rename while a file under it is open, and a missing file cannot be open.
    missing = summary.with_name("transcript.txt")
    assert child(write_attempt(missing), locks=["transcript.txt"])["winerror"] == 32
    lecture = summary.parent
    code = f"print(json.dumps(attempt(os.rename, {str(lecture)!r}, {str(lecture) + '2'!r})))"
    assert child(code, locks=["transcript.txt"]) == {"ok": True}


@pytest.mark.parametrize("locks", [None, "{not json", "[]"])
def test_no_or_corrupt_locks_file_locks_nothing(child, summary, locks):
    assert child(write_attempt(summary), locks=locks) == {"ok": True}


def test_crud_reads_win32_while_the_real_platform_is_unchanged(child):
    code = "import fs.crud\nprint(json.dumps([fs.crud.sys.platform, sys.platform]))"
    assert child(code) == ["win32", sys.platform]
