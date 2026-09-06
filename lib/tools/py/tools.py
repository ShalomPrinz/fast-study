import os
import subprocess
from pathlib import Path

# curl is not bundled: Windows 10+ ships curl.exe, so it resolves off PATH even in a package.
_SYSTEM_TOOLS = {"curl"}

_EXE_SUFFIX = ".exe" if os.name == "nt" else ""

# ffmpeg and ffprobe print their banner for `--version` but exit 1, having no input file to work
# on; `-version` is the form that exits 0. Everything else takes the GNU spelling.
_VERSION_FLAG = {"ffmpeg": "-version", "ffprobe": "-version"}

# Long enough for a cold binary on a slow disk, short enough that four of them cannot delay boot
# past the launcher's health wait.
_VERSION_TIMEOUT_SECONDS = 15


def tool_path(name: str) -> str:
    """How to spawn an external tool: an absolute path under FASTSTUDY_BIN_DIR when the launcher
    set one, else the bare name for PATH to resolve, which is dev."""

    bin_dir = os.environ.get("FASTSTUDY_BIN_DIR")
    if not bin_dir or name in _SYSTEM_TOOLS:
        return name
    return str(Path(bin_dir) / f"{name}{_EXE_SUFFIX}")


def _check_one(name: str) -> str:
    """Spawn one tool's version flag; "ok" or a one-line reason it cannot be used."""

    try:
        run = subprocess.run(
            [tool_path(name), _VERSION_FLAG.get(name, "--version")],
            capture_output=True,
            timeout=_VERSION_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        return "missing"
    except OSError as e:  # a directory, a non-executable file, a bad interpreter
        return f"unusable: {e.strerror or e}"
    except subprocess.TimeoutExpired:
        return f"timed out after {_VERSION_TIMEOUT_SECONDS}s"
    return "ok" if run.returncode == 0 else f"exited {run.returncode}"


def check_tools(names) -> dict[str, str]:
    """Every name mapped to "ok" or why it is not usable. Never raises: a missing tool disables
    one feature, so the caller reports it and keeps serving rather than refusing to start."""

    return {name: _check_one(name) for name in names}
