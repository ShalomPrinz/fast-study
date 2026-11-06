import pytest


# A fresh summarize clears the summary's figures through the database; a no-op unless a test patches it.
@pytest.fixture(autouse=True)
def no_figure_clear(monkeypatch):
    from unittest.mock import MagicMock

    from services import db_client

    monkeypatch.setattr(db_client, "delete_figures", MagicMock())
