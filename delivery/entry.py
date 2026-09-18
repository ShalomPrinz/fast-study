"""Frozen entry point for `services.exe`, picking a Python service by argv[1]; dev never runs it."""

import sys

import runtime

_MODES = ("backend", "database")


def main() -> None:
    """Dispatch on argv[1] and serve the selected service."""

    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in _MODES:
        sys.exit(f"usage: services {{{'|'.join(_MODES)}}}")

    # Imported here, after `runtime` (whose import loads .env the services read while importing), and
    # per branch so one service's import-time failure cannot stop the other.
    if mode == "backend":
        import backend_main as service
    else:
        import database_main as service

    runtime.serve(service.app, default_port=service.DEFAULT_PORT)


if __name__ == "__main__":
    main()
