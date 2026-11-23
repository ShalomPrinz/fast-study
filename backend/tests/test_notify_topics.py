"""Every backend notify names its topics (database/docs/EVENTS.md)."""

import ast
from pathlib import Path

import pytest
from services import db_client as real_db

_BACKEND = Path(__file__).parent.parent
_SKIP = {"tests", ".venv", "__pycache__"}


def test_no_notify_call_is_bare():
    bare = []
    for path in _BACKEND.rglob("*.py"):
        if _SKIP & set(path.relative_to(_BACKEND).parts):
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "notify"
                and not node.args
            ):
                bare.append(f"{path.relative_to(_BACKEND)}:{node.lineno}")
    assert bare == []


def test_notify_requires_a_topic():
    with pytest.raises(TypeError):
        real_db.notify()


def test_notify_posts_its_topics(monkeypatch):
    posted = []
    monkeypatch.setattr(
        real_db._session, "post", lambda url, **kw: posted.append((url, kw["json"]))
    )
    real_db.notify("runner", "tree")
    assert posted == [
        (f"{real_db.DATABASE_URL}/notify", {"topics": ["runner", "tree"]})
    ]
