import pytest


# A fresh summarize clears the summary's figures through the database; a no-op unless a test patches it.
@pytest.fixture(autouse=True)
def no_figure_clear(monkeypatch):
    from unittest.mock import MagicMock

    from services import db_client

    monkeypatch.setattr(db_client, "delete_figures", MagicMock())


@pytest.fixture
def real_marker():
    """Opt a test out of `no_figures_marker` so it exercises the real marker write/drop."""


# The summarize marker write/drop is a database call; offline tests must not reach port 8001.
@pytest.fixture(autouse=True)
def no_figures_marker(request, monkeypatch):
    if "real_marker" in request.fixturenames:
        return
    from unittest.mock import MagicMock

    from pipeline import runner

    monkeypatch.setattr(runner, "_set_figures_pending", MagicMock(return_value=False))
