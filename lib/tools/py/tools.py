import os
import subprocess
from pathlib import Path

# curl is not bundled: Windows 10+ ships curl.exe, so it resolves off PATH even in a package.
_SYSTEM_TOOLS = {"curl"}

_EXE_SUFFIX = ".exe" if os.name == "nt" else ""

# ffmpeg prints its banner for `--version` but exits 1, having no input file to work on;
# `-version` is the form that exits 0. Everything else takes the GNU spelling.
_VERSION_FLAG = {"ffmpeg": "-version"}

# Long enough for a cold binary on a slow disk, short enough that a few of them cannot delay boot
# past the launcher's health wait.
_VERSION_TIMEOUT_SECONDS = 15


def tool_path(name: str) -> str:
    """How to spawn an external tool: an absolute path under FASTSTUDY_BIN_DIR when the launcher
    set one, else the bare name for PATH to resolve, which is dev."""

    bin_dir = os.environ.get("FASTSTUDY_BIN_DIR")
    if not bin_dir or name in _SYSTEM_TOOLS:
        return name
    return str(Path(bin_dir) / f"{name}{_EXE_SUFFIX}")


def _failure(state: str, code: str, **params) -> dict:
    """One probe failure: the machine code and its params beside the developer-facing reason."""

    return {"state": state, "code": code, "params": params}


def _check_one(name: str) -> str | dict:
    """Spawn one tool's version flag; "ok" or a failure record saying why it cannot be used."""

    try:
        run = subprocess.run(
            [tool_path(name), _VERSION_FLAG.get(name, "--version")],
            capture_output=True,
            timeout=_VERSION_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        return _failure("missing", "tool_missing", tool=name)
    except OSError as e:  # a directory, a non-executable file, a bad interpreter
        detail = e.strerror or str(e)
        return _failure(f"unusable: {detail}", "tool_unusable", tool=name, detail=detail)
    except subprocess.TimeoutExpired:
        return _failure(
            f"timed out after {_VERSION_TIMEOUT_SECONDS}s",
            "tool_probe_timeout",
            tool=name,
            seconds=_VERSION_TIMEOUT_SECONDS,
        )
    if run.returncode == 0:
        return "ok"
    return _failure(
        f"exited {run.returncode}",
        "tool_probe_exit",
        tool=name,
        exit_code=run.returncode,
    )


def check_tools(names) -> dict[str, str | dict]:
    """Every name mapped to "ok" or a {state, code, params} record saying why it is not usable.
    Never raises: a missing tool disables one feature, so the caller reports it and keeps serving
    rather than refusing to start. Success stays the bare string, so `!= "ok"` keeps its meaning."""

    return {name: _check_one(name) for name in names}
