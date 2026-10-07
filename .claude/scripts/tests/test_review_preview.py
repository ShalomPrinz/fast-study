"""Tests for review_preview.py, run as a subprocess against a throwaway git repo (.claude/scripts/README.md)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "review_preview.py"
OWNERSHIP = (
    '{"agents": {"database-dev": ["database/"], "lib-dev": ["lib/"], "frontend-dev": ["frontend/"]},'
    ' "packages": ["database/", "lib/", "frontend/"]}'
)


def git(*args: str, cwd: Path) -> str:
    done = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return done.stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A committed mini repo with the script in place: ownership map, a database doc, a lib module with two halves."""
    files = {
        ".claude/ownership.json": OWNERSHIP,
        "database/CLAUDE.md": "Paths are built in `fs/paths.py`.\n",
        "database/fs/paths.py": "ROOT_DEPTH = 2\n\n\ndef lecture_dir():\n    pass\n",
        "database/fs/tree.py": "from fs.paths import lecture_dir\n\nlecture_dir()\n",
        "lib/runtime/py/runtime.py": "PORT_ENV = 'FASTSTUDY_PORT'\n",
        "lib/runtime/js/runtime.js": "export const PORT_ENV = 'FASTSTUDY_PORT'\n",
        "frontend/src/api.ts": "export function loadTree() {}\n",
        "frontend/src/App.tsx": "import { loadTree } from './api'\nloadTree()\n",
        "frontend/src/locales/en/messages.po": '#: src/App.tsx:1\nmsgid "Tree"\n',
    }
    for rel, text in files.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text)
    (tmp_path / ".claude/scripts").mkdir(parents=True)
    shutil.copy(SCRIPT, tmp_path / ".claude/scripts/review_preview.py")
    git("init", "-q", cwd=tmp_path)
    git("add", "-A", cwd=tmp_path)
    git("commit", "-q", "-m", "init", cwd=tmp_path)
    return tmp_path


def preview(repo: Path, *paths: str, cwd: Path | None = None) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    script = repo / ".claude/scripts/review_preview.py"
    done = subprocess.run(
        [sys.executable, str(script), *paths],
        cwd=cwd or repo,
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    assert done.returncode == 0, done.stderr
    return done.stdout


def test_clean_tree_says_so_and_changes_nothing(repo: Path) -> None:
    assert "No uncommitted changes." in preview(repo)
    assert git("status", "--porcelain", cwd=repo) == ""


def test_untracked_file_content_and_doc_hygiene(
    repo: Path, tmp_path_factory: pytest.TempPathFactory
) -> None:
    (repo / "notes.md").write_text(
        "See [db](database/CLAUDE.md) and [gone](docs/gone.md).\n"
    )
    (repo / "CLAUDE.md").write_text("Read @docs/gone.md first.\n")
    out = preview(
        repo, cwd=tmp_path_factory.mktemp("elsewhere")
    )  # the tree is the script's own, not the cwd's
    assert (
        "Untracked `notes.md` (1 lines):" in out
        and "See [db](database/CLAUDE.md)" in out
    )
    assert (
        "`notes.md:1`: broken link `docs/gone.md`" in out
        and "broken link `database/CLAUDE.md`" not in out
    )
    assert "`CLAUDE.md:1`: `@docs/gone.md` inlines a file" in out
    assert "check 3 not needed" in out
    assert git("status", "--porcelain", cwd=repo).splitlines() == [
        "?? CLAUDE.md",
        "?? notes.md",
    ]


def test_stale_reference_changed_value_ownership_and_invariants(repo: Path) -> None:
    (repo / "database/fs/paths.py").write_text(
        "ROOT_DEPTH = 3\n\n\ndef course_dir():\n    return httpx.get\n"
    )
    (repo / "lib/runtime/py/runtime.py").write_text(
        "PORT_ENV = 'FASTSTUDY_LISTEN_PORT'\n"
    )
    out = preview(repo)
    assert (
        "- `lecture_dir` removed, still referenced:" in out
        and "database/fs/tree.py:1:" in out
    )
    assert "`database/fs/paths.py:1`: 2 -> 3" in out
    assert "| `database/fs/paths.py` | database-dev | database/CLAUDE.md |" in out
    assert (
        "`database/fs/paths.py`: service code changed with no owning doc in the diff."
        in out
    )
    assert "`database/fs/paths.py`: DATA_ROOT layout" in out
    assert "`database/fs/paths.py:5`: `httpx` in database/" in out
    assert "`lib/runtime`: only its `py/` half changed" in out


def test_js_export_stale_reference_and_path_filter(repo: Path) -> None:
    (repo / "frontend/src/api.ts").write_text("export function fetchTree() {}\n")
    (repo / "frontend/src/locales/en/messages.po").write_text(
        '#: src/App.tsx:2\nmsgid "Tree"\n'
    )
    (repo / "database/fs/paths.py").write_text("ROOT_DEPTH = 9\n")
    out = preview(repo, "frontend/")
    assert (
        "## Changed values" not in out
    )  # a catalog's shifted line refs are not value changes
    assert (
        "- `loadTree` removed, still referenced:" in out
        and "frontend/src/App.tsx:" in out
    )
    assert "database/fs/paths.py" not in out


def test_multiline_comments_show_only_changed_two_plus_line_blocks(repo: Path) -> None:
    (repo / "database/fs/tree.py").write_text(
        "# one line\nx = 1\n# first\n# second\ny = 2\n"
        'def f():\n    """Doc first.\n\n    Doc second.\n    """\n'
    )
    (repo / "frontend/src/api.ts").write_text(
        "/**\n * only one\n */\nexport function loadTree() {}\n"
        "// a\n// b\nclass A { #priv = 1 }\n"
    )
    out = preview(repo)
    assert "`database/fs/tree.py:3-4` (2 lines): first" in out
    assert "`database/fs/tree.py:7-10` (2 lines): Doc first." in out
    assert "`frontend/src/api.ts:5-6` (2 lines): a" in out
    assert "one line" not in out and "only one" not in out and "priv" not in out


def test_triple_quoted_data_strings_are_not_comments(repo: Path) -> None:
    (repo / "database/fs/tree.py").write_text(
        '"""Module doc first.\nModule doc second.\n"""\n'
        'QUERY = (\n    """\n    SELECT a\n    # not a comment\n    FROM b\n    """\n)\n'
        'run(\n    x,\n    """\n    arg one\n    arg two\n    """,\n)\n'
        "def g(\n    a: int,\n) -> None:\n"
        '    """Real doc first.\n\n    Real doc second.\n    """\n'
        'conn.execute("""\n    # inline one\n    # inline two\n""")\n'
        'def h():\n    """After inline first.\n    After inline second."""\n'
    )
    out = preview(repo)
    assert "`database/fs/tree.py:1-3` (2 lines): Module doc first." in out
    assert "`database/fs/tree.py:21-24` (2 lines): Real doc first." in out
    assert "`database/fs/tree.py:30-31` (2 lines): After inline first." in out
    assert "SELECT" not in out and "not a comment" not in out and "arg one" not in out
    assert "inline one" not in out


def test_quotes_and_trailing_comments_do_not_desync_data_strings(repo: Path) -> None:
    (repo / "database/fs/tree.py").write_text(
        'x = 1  # see """\n# real one\n# real two\n'
        'def f():  # noqa\n    """Noqa doc first.\n    Noqa doc second."""\n'
        's = \'"""\' + """\n# s1\n# s2\n"""\n'
    )
    out = preview(repo)
    assert "`database/fs/tree.py:2-3` (2 lines): real one" in out
    assert "`database/fs/tree.py:5-6` (2 lines): Noqa doc first." in out
    assert "s1" not in out


def test_data_string_open_at_eof_adds_no_block(repo: Path) -> None:
    (repo / "database/fs/tree.py").write_text('# c1\n# c2\ns = (\n    """\n    tail\n')
    out = preview(repo)
    assert "`database/fs/tree.py:1-2` (2 lines): c1" in out
    assert out.count("database/fs/tree.py:1-") == 1


def test_multiline_comment_untouched_by_diff_is_not_shown(repo: Path) -> None:
    (repo / "database/fs/tree.py").write_text("# old\n# block\nx = 1\n")
    git("commit", "-qam", "block", cwd=repo)
    (repo / "database/fs/tree.py").write_text("# old\n# block\nx = 2\n")
    assert "## Multi-line comments" not in preview(repo)
