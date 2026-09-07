"""Locates the read-only files shipped with the service, wherever they happen to live."""

import sys
from pathlib import Path

# Frozen, `__file__` points inside the bundle's module archive rather than at the backend root, so
# the shipped `datas` are read from where PyInstaller extracted them: sys._MEIPASS. In dev they sit
# at the backend root, two levels up from this file.
_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))


def resource_path(*parts) -> Path:
    """Join a shipped read-only file — anything under assets/, plus credentials.json — onto
    whichever root holds it."""

    return _ROOT.joinpath(*parts)
