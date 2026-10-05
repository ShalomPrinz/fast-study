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
    assert "check 4 not needed" in out
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
