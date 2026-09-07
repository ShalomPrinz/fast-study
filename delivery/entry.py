"""Frozen entry point for `services.exe`: one bundle holding both Python services, picked by argv[1].

Exists only inside the PyInstaller bundle — dev runs each service's own module directly.
"""

import sys

import runtime

_MODES = ("backend", "database")


def main() -> None:
    """Dispatch on argv[1] and serve the selected service."""

    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in _MODES:
        sys.exit(f"usage: services {{{'|'.join(_MODES)}}}")

    # Imported inside the branch, not at module scope: `runtime` calls load_dotenv() at import and
    # both services read env while importing, so `runtime` has to already be in sys.modules — and
    # one service's import-time failure must not stop the other from starting.
    if mode == "backend":
        import backend_main as service
    else:
        import database_main as service

    runtime.serve(service.app, default_port=service.DEFAULT_PORT)


if __name__ == "__main__":
    main()
